import asyncio, os, re, sqlite3
from pathlib import Path

from contextlib import contextmanager
import threading
class DatabaseConnectionPool:
    def __init__(self, db_path, setup_connection):
        """
        setup_connection is a function to call to configure new database connections.
        """
        self.db_path = db_path
        self.setup_connection = setup_connection
        self.connections = []
        self.lock = threading.Lock()

    @contextmanager
    def get(self, existing_connection=None):
        """
        A context manager for using a connection from the pool.

        If existing_connection isn't None, it's a connection that's already being
        used.  We'll yield it and not do anything else.  This allows using a connection
        from a caller.  For example:

        with db_pool.get(connection) as connection:
            ...
        
        If connection is None, we'll return a new connection (possibly from the pool).  It
        will be committed on completion or rolled back on exception.

        If connection isn't None, it'll be used as-is.  It won't be committed or rolled back.
        The top-level context manager will do that.
        """
        if existing_connection:
            yield existing_connection
            return

        connection = None
        with self.lock:
            if self.connections:
                connection = self.connections.pop()
            else:
                connection = sqlite3.connect(self.db_path, check_same_thread=False)
                if self.setup_connection is not None:
                    self.setup_connection(connection)

        try:
            yield connection
            connection.commit()
        finally:
            connection.rollback()

            with self.lock:
                self.connections.append(connection)

# This implements the database storage for file_index.  It stores similar data to
# what we get from the Windows index.
class IndexDatabase:
    def setup_connection(self, conn):
        conn.row_factory = sqlite3.Row

        conn.execute('PRAGMA journal_mode = WAL')

        # Why is this on by default?
        conn.execute('PRAGMA secure_delete = 0;')

        # Why is this off by default?
        conn.execute('PRAGMA foreign_keys = ON')

        # Use the fastest sync mode.  Our data is only a cache, so we don't care that much
        # if it loses data during a power loss.
        conn.execute('PRAGMA synchronous = OFF;')

        # Enable read_uncommitted.  This means that searches will never be blocked by a write
        # lock during an update.  This can give inconsistent results if data is read during
        # a transaction, but that's harmless for our use case and it's much more important to
        # not stall a search.
        conn.execute('PRAGMA read_uncommitted = ON;')

        # Do first-time initialization and any migrations.
        self.upgrade(conn)

    def __init__(self, db_path):
        """
        db_path is the path to the database on the filesystem.
        """
        self.db_pool = DatabaseConnectionPool(db_path, self.setup_connection)
        self.db_path = db_path

        # Open the DB now to create it.
        with self.db_pool.get() as conn:
            pass

    def get_tables(self, conn):
        result = []
        for table in conn.execute('SELECT name FROM sqlite_master WHERE type="table"'):
            result.append(table['name'])
        return result

    def db_version(self, conn):
        if 'info' not in self.get_tables(conn):
            return 0

        for row in conn.execute('select version from info'):
            return row['version']

        assert False

    def upgrade(self, conn):
        if self.db_version(conn) == 0:
            with conn:
                conn.execute('CREATE TABLE info(version)')
                conn.execute('INSERT INTO info (version) values (?)', (1,))

                conn.execute('''
                    CREATE TABLE files(
                        id INTEGER PRIMARY KEY,
                        mtime NOT NULL,
                        ctime NOT NULL,
                        path UNIQUE NOT NULL,
                        is_directory NOT NULL DEFAULT false,
                        parent NOT NULL,
                        width,
                        height,
                        tags NOT NULL,
                        title NOT NULL,
                        comment NOT NULL,
                        type NOT NULL,
                        author NOT NULL,
                        bookmarked NOT NULL DEFAULT false,
                        directory_thumbnail_path
                    )
                ''')

                conn.execute('CREATE INDEX files_path on files(path)')
                conn.execute('CREATE INDEX files_parent on files(lower(parent))')
                conn.execute('CREATE INDEX files_bookmarked on files(bookmarked) WHERE bookmarked')

                # The file tag index and the filename word index.  These should be searched with:
                #
                # SELECT * from file_tags WHERE LOWER(tag) GLOB "pattern*";
                #
                # for the best chance that the search can use the tag index.
#                conn.execute('''
#                    CREATE TABLE file_tags(
#                        file_id NOT NULL,
#                        tag NOT NULL,
#                        FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
#                    )
#                ''')
#                conn.execute('CREATE INDEX file_tags_file_id on file_tags(file_id)')
#                conn.execute('CREATE INDEX file_tags_tag on file_tags(lower(tag))')

                # This table indexes words in the filename.
                conn.execute('''
                    CREATE TABLE file_keywords(
                        file_id NOT NULL,
                        keyword NOT NULL,
                        FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                    )
                ''')
                conn.execute('CREATE INDEX file_keyords_file_id on file_keywords(file_id)')
                conn.execute('CREATE INDEX file_keywords_keyword on file_keywords(lower(keyword))')

        assert self.db_version(conn) == 1

    @classmethod
    def split_keywords(self, filename):
        keywords = re.split(r'([a-z0-9]+)', filename, flags=re.IGNORECASE)
        keywords = { keyword.strip() for keyword in keywords }
        keywords -= { '.', '' }
        return keywords

    def add_record(self, entry, conn=None):
        """
        Add a record, returning its ID.

        If a record for this path already exists, it will be replaced.
        """
        with self.db_pool.get(conn) as conn:
            fields = list(entry.keys())

            cursor = conn.cursor()

            # These fields are included in the keyword index.
            keyword_fields = ('path', 'tags', 'title', 'comment', 'author')

            # See if this file already exists in the database.
            query = """
                SELECT *
                FROM files
                WHERE path = ?
                """
            result = list(cursor.execute(query, (entry['path'],)))
            existing_record = result[0] if result else None

            if existing_record:
                # The record already exists.  Update all fields except for path and parent,
                # whichare invariant.  This is much faster than letting INSERT OR REPLACE replace
                # the record.
                rowid = existing_record['id']
                fields.remove('path')
                fields.remove('parent')
                row = [entry[key] for key in fields]
                row.append(entry['path'])
                sets = ['%s = ?' % field for field in fields]
                query = '''
                    UPDATE files
                        SET %(sets)s
                        WHERE path = ?
                ''' % {
                    'sets': ', '.join(sets),
                }
                cursor.execute(query, row)

                # If any field in keyword_fields has changed, we need to update the keyword index.
                tag_update_needed = False
                for keyword_field in keyword_fields:
                    tag_update_needed |= existing_record[keyword_field] != entry[keyword_field]
            else:
                # The record doesn't exist, so create a new one.
                tag_update_needed = True

                row = [entry[key] for key in fields]

                query = '''
                    INSERT OR REPLACE INTO files
                        (%(fields)s)
                        VALUES (%(placeholders)s)
                ''' % {
                    'fields': ', '.join(fields),
                    'placeholders': ', '.join('?'*len(fields))
                }
                cursor.execute(query, row)
                rowid = cursor.lastrowid

            # Add tags.  Ignore any duplicates.
    #        tag_list = set(entry['tags'].split(' '))
    #        tags_to_add = []
    #        for tag in tag_list:
    #            tags_to_add.append((rowid, tag))
    #
    #        cursor.executemany('''
    #            INSERT INTO file_tags (file_id, tag) values (?, ?)
    #        ''', tags_to_add)

            # Only update keywords if needed.
            if tag_update_needed:
                # Delete old keywords.
                cursor.execute('DELETE FROM file_keywords WHERE file_id = ?', [rowid])

                # Split strings that we include in keyword searching.
                keywords = set()
                for keyword_field in keyword_fields:
                    if keyword_field == 'path':
                        keywords |= self.split_keywords(os.path.basename(entry['path']))
                    else:
                        keywords |= self.split_keywords(entry[keyword_field])

                keywords_to_add = []
                for keyword in keywords:
                    keywords_to_add.append((rowid, keyword))

                cursor.executemany('''
                    INSERT INTO file_keywords (file_id, keyword) values (?, ?)
                ''', keywords_to_add)

            cursor.close()

        return rowid

    def delete_record(self, path, conn):
        """
        Remove path from the database.
        """
        with self.db_pool.get(conn) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM files WHERE path = ?', [path])
            cursor.close()

    def get(self, path, conn=None):
        query = """
            SELECT files.*
            FROM files
            WHERE path = ?
        """
        with self.db_pool.get(conn) as conn:
            for row in conn.execute(query, [path]):
                result = dict(row)
                del result['id']
                result['path'] = Path(result['path'])
                return result

        return None

    def search(self, *, path=None, recurse=True, substr=None, bookmarked=None, include_files=True, include_dirs=True):
        with self.db_pool.get() as conn:
            # SELECT * from file_tags WHERE LOWER(tag) GLOB "pattern*";
            where = []
            params = []
                
            if path is not None:
                if recurse:
                    # path is the top directory to start searching from.
                    where.append('lower(files.path) GLOB lower(?)')
                    params.append(path + '*')
                else:
                    # Only list files directly inside path.
                    where.append('lower(files.parent) = lower(?)')
                    params.append(path)

            if not include_files:
                where.append('files.is_directory')
            if not include_dirs:
                where.append('not files.is_directory')
            if bookmarked:
                where.append('files.bookmarked')

            joins = []
            if substr:
                joins.append('file_keywords')
                where.append('files.id = file_keywords.file_id')
                for word in self.split_keywords(substr):
                    # XXX: the param order here is brittle, but named parameters are awkward too
                    where.append('lower(file_keywords.keyword) GLOB lower(?)')
                    params.append(word)

            where = ('WHERE ' + ' AND '.join(where)) if where else ''
            joins = ('JOIN ' + ', '.join(joins)) if joins else ''

            query = """
                SELECT files.*
                FROM files AS files
                %(joins)s
                %(where)s
            """ % {
                'joins': joins,
                'where': where,
            }

            for row in conn.execute(query, params):
                result = dict(row)
                del result['id']
                result['path'] = Path(result['path'])
                yield result

async def test():
    db = IndexDatabase('index.sqlite')
    entry = {
        'path': 'a',
        'mtime': 10,
        'ctime': 10,
        'is_directory': True,
        'parent': 'a',
        'width': 'a',
        'height': 'a',
        'tags': 'tag1 tag2 tag3',
        'title': 'title',
        'comment': 'some comment',
        'type': 'type',
        'author': 'an author',
        'bookmarked': 'a',
    }

    conn = db.begin()
    db.add_record(entry, conn=conn)
    db.end(conn)

    entry['comment'] = 'foo'
    db.add_record(entry)

    for entry in db.search(): #substr='tag1'):
        print(entry)
    return

    print('go:')
    for row in db.conn.execute('select * from file_tags'):
        print(row['file_id'], row['tag'])

if __name__ == '__main__':
    asyncio.run(test())
