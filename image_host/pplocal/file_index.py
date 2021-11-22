import asyncio, os, re, sqlite3
from pathlib import Path
from pprint import pprint

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

class Database:
    def setup_connection(self, conn):
        conn.row_factory = sqlite3.Row

    def __init__(self, db_path):
        """
        db_path is the path to the database on the filesystem.
        """
        self.db_pool = DatabaseConnectionPool(db_path, self.setup_connection)
        self.db_path = db_path

        # Open the DB now to create it.
        with self.db_pool.get() as conn:
            pass

class FileIndexDatabase(Database):
    def setup_connection(self, conn):
        super().setup_connection(conn)

# This implements the database storage for library.  It stores similar data to
# what we get from the Windows index.
class FileIndex:
    def setup_connection(self, conn):
        conn.row_factory = sqlite3.Row

        # Use WAL.  This means commits won't be transactional across all of our databases,
        # but they don't need to be, and WAL is significantly faster.
        conn.execute('PRAGMA journal_mode = WAL')

        # Why is this on by default?
        conn.execute('PRAGMA secure_delete = 0;')

        # Why is this off by default?
        conn.execute('PRAGMA foreign_keys = ON')

        # Use the fastest sync mode.  Our data is only a cache, so we don't care that much
        # if it loses data during a power loss.
        # XXX on for user db
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

    def upgrade(self, conn):
        with conn:
            # If there's no info table, start by just creating it at version 0, so _get_info
            # and _set_info work.
            if 'info' not in self.get_tables(conn):
                conn.execute('''
                    CREATE TABLE info(
                        id INTEGER PRIMARY KEY,
                        version,
                        last_updated_at NOT NULL
                    )
                ''')
                conn.execute('INSERT INTO info (id, version, last_updated_at) values (1, ?, 0)', (0,))

            if self.get_db_version(conn) == 0:
                self.set_db_version(1, conn=conn)
            
                conn.execute('''
                    CREATE TABLE files(
                        id INTEGER PRIMARY KEY,
                        mtime NOT NULL,
                        ctime NOT NULL,
                        path UNIQUE NOT NULL,
                        parent NOT NULL,
                        is_directory NOT NULL DEFAULT false,
                        inode NOT NULL,
                        volume_id,
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
                conn.execute('CREATE INDEX files_file_id on files(inode, volume_id)')

                # This should be searched with:
                #
                # SELECT * from file_tags WHERE LOWER(tag) GLOB "pattern*";
                #
                # for the best chance that the search can use the tag index.
                conn.execute('''
                    CREATE TABLE file_keywords(
                        file_id NOT NULL,
                        keyword NOT NULL,
                        FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                    )
                ''')
                conn.execute('CREATE INDEX file_keyords_file_id on file_keywords(file_id)')
                conn.execute('CREATE INDEX file_keywords_keyword on file_keywords(lower(keyword))')

        assert self.get_db_version(conn) == 1

    def get_tables(self, conn):
        result = []
        for table in conn.execute('SELECT name FROM sqlite_master WHERE type="table"'):
            result.append(table['name'])
        return result

    def _get_info(self, conn):
        """
        Return the one row from the info table.
        """
        with self.db_pool.get(conn) as conn:
            for result in conn.execute('SELECT * FROM info WHERE id = 1'):
                return result
            else:
                raise Exception('No info field in db: %s' % self)

    def _set_info(self, field, value, *, conn=None):
        with self.db_pool.get(conn) as conn:
            query = '''
                UPDATE info
                    SET %(field)s = ?
                    WHERE id = 1
            ''' % {
                'field': field
            }
            conn.execute(query, [value])
        
        return self._get_info(conn)['last_updated_at']

    def get_db_version(self, conn):
        return self._get_info(conn)['version']
    def set_db_version(self, version, conn):
        return self._set_info('version', version, conn=conn)

    def get_last_update_time(self, conn=None):
        return self._get_info(conn)['last_updated_at']
    def set_last_update_time(self, value, conn=None):
        self._set_info('last_updated_at', value, conn=conn)

    @classmethod
    def split_keywords(self, filename):
        keywords = re.split(r'([a-z0-9]+)', filename, flags=re.IGNORECASE)
        keywords = { keyword.strip() for keyword in keywords }
        keywords -= { '.', '' }
        return keywords

    def xxxfind_by_entry(self, entry, *, conn=None):
        """
        """
        with self.db_pool.get(conn) as conn:
            inode = entry['inode']
            volume = entry['volume']

            for entry in conn.execute('''
                SELECT * FROM FILES
                WHERE inode = ? AND volume = ?
            ''', [inode, volume]):
                print('Found by inode')
                return entry
            # XXX: try filename second
            return None
        
    def add_record(self, entry, conn=None):
        """
        Add or update a file record.  Set entry['id'] to the new or updated record's
        ID.

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
                # which are invariant (except for renames which we don't do here)  This is much
                # faster than letting INSERT OR REPLACE replace the record.
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
                
                # Set the ID in our caller's entry to the existing ID.
                entry['id'] = existing_record['id']
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

                # Fill in the ID.
                entry['id'] = rowid

            # Only update keywords if needed.
            if tag_update_needed:
                # Delete old keywords.
                cursor.execute('DELETE FROM file_keywords WHERE file_id = ?', [entry['id']])

                # Split strings that we include in keyword searching.
                keywords = set()
                for keyword_field in keyword_fields:
                    if keyword_field == 'path':
                        keywords |= self.split_keywords(os.path.basename(entry['path']))
                    else:
                        keywords |= self.split_keywords(entry[keyword_field])

                keywords_to_add = []
                for keyword in keywords:
                    keywords_to_add.append((entry['id'], keyword))

                cursor.executemany('''
                    INSERT INTO file_keywords (file_id, keyword) values (?, ?)
                ''', keywords_to_add)

            cursor.close()
        return entry

    def delete_recursively(self, paths, *, conn=None):
        """
        Remove a list of file paths from the database.

        If this includes directories, all entries for files inside the directory
        will be removed recursively.
        """
        with self.db_pool.get(conn) as conn:
            # If path includes "/path", we need to delete "/path" and files matching
            # "/path/*", but not "/path*".
            # XXX: do this in search below too
            path_list = [(str(path), str(path) + os.path.sep + '*') for path in paths]
            count = conn.total_changes
            conn.executemany('''
                DELETE FROM files
                WHERE
                    LOWER(files.path) = LOWER(?) OR
                    LOWER(files.path) GLOB LOWER(?)
            ''', path_list)

            deleted = conn.total_changes - count
            # print('Deleted %i (%s)' % (deleted, paths))

    def rename(self, old_path, new_path, *, conn=None):
        with self.db_pool.get(conn) as conn:
            # Update "path" and "parent" for old_path and all files inside it.
            print('Renaming "%s" -> "%s"' % (old_path, new_path))

            for entry in self.search(path=str(old_path), recurse=True, substr=None):
                # path should always be relative to old_path.
                # parent should too, unless this is old_path itself.
                path = Path(entry['path'])
                relative_path = path.relative_to(old_path)
                entry_new_path = new_path / relative_path
                if path != old_path:
                    relative_parent = Path(entry['parent']).relative_to(old_path)
                    entry_new_parent = new_path / relative_parent
                else:
                    entry_new_parent = entry['parent']

                query = '''
                    UPDATE files
                        SET path = ?, parent = ?
                        WHERE id = ?
                ''' % {
                    'path': '',
                    'parent': '',
                }
                conn.execute(query, [str(entry_new_path), str(entry_new_parent), entry['id']])

    def get(self, path, conn=None):
        path = str(path)

        query = """
            SELECT files.*
            FROM files
            WHERE path = ?
        """
        with self.db_pool.get(conn) as conn:
            for row in conn.execute(query, [path]):
                return dict(row)

        return None

    def search(self, *, path=None, recurse=True, substr=None, bookmarked=None, include_files=True, include_dirs=True):
        with self.db_pool.get() as conn:
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

            # XXX: very slow for multiple keywords: slower for multiple, should be faster
            # might be faster to only search for one keyword, then do the rest from the tag list
            # or search for keywords first, group them manually, then grab the files
            joins = []
            if substr:
                for word_idx, word in enumerate(self.split_keywords(substr)):
                    alias = 'keyword%i' % word_idx
                    joins.append('file_keywords AS %s' % alias)
                    where.append('files.id = %s.file_id' % alias)
                    print('xxx', word)
                    # XXX: the param order here is brittle, but named parameters are awkward too
                    where.append('lower(%s.keyword) GLOB lower(?)' % alias)
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
                yield result

async def test():
    try:
        os.unlink('test.sqlite')
    except FileNotFoundError:
        pass

    db = FileIndex('test.sqlite')

    # A base entry for testing.  We don't do anything special with most fields and
    # it's mostly paths that need testing.
    test_entry = {
        # 'path': 'a',
        # 'parent': 'a',

        'mtime': 10,
        'ctime': 10,
        'is_directory': True,
        'inode': 0, 
        'volume_id': 0,
        'width': 'a',
        'height': 'a',
        'tags': '',
        'title': '',
        'comment': '',
        'type': '',
        'author': '',
        'bookmarked': False,
        'directory_thumbnail_path': None,
    }
    
    def path_record(path):
        path = Path(path)
        entry = test_entry.copy()
        entry.update({
            'path': str(path),
            'parent': str(path.parent),
        })
        return entry

    path = Path('f:/foo')

    # Test adding an entry.
    entry = path_record(path)
    db.add_record(entry)
    assert Path(db.get(entry['path'])['path']) == path

    # Test deleting an entry.
    db.delete_recursively([str(path)])
    entry = db.get(entry['path'])
    assert entry is None, entry

    # Test adding a directory and a subdirectory.
    path2 = path / 'bar'
    db.add_record(path_record(path))
    db.add_record(path_record(path2))
    assert Path(db.get(path)['path']) == path, entry
    assert Path(db.get(path2)['parent'])  == path, entry

    # Test deleting the tree.
    db.delete_recursively([str(path)])
    assert db.get(path) is None, entry
    assert db.get(path2) is None, entry

    # Add directories again.  Add a third unrelated directory that we'll test to
    # be sure it's unaffected by the rename.
    db.add_record(path_record(path))
    db.add_record(path_record(path2))
    path3 = Path('f:/unrelated')
    db.add_record(path_record(path3))

    # Rename f:/foo to f:/test.  This will affect entry and entry2.
    db.rename(path, Path('f:/test'))

    # Test that the entries have been renamed correctly.
    assert db.get(path) is None, entry
    assert db.get(path2) is None, entry
    assert db.get(path3) is not None, entry
    new_entry = db.get(Path('f:/test'))
    assert Path(new_entry['path']) == Path('f:/test')
    assert Path(new_entry['parent']) == Path('f:/')

#    entry['comment'] = 'foo'
#    db.add_record(entry)
#
#    for entry in db.search(): #substr='tag1'):
#        print(entry)
    return

    print('go:')
    for row in db.conn.execute('select * from file_tags'):
        print(row['file_id'], row['tag'])

if __name__ == '__main__':
    asyncio.run(test())
