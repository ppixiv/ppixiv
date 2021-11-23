import asyncio, os, re
from enum import Enum
from pathlib import Path
from .database import Database, transaction
from pprint import pprint

# This implements the database storage for library.  It stores similar data to
# what we get from the Windows index.
class FileIndex(Database):
    def __init__(self, db_path, *, schema='files', user_data):
        """
        db_path is the path to the database on the filesystem.

        user_data is a UserData database.
        """
        self.user_data = user_data

        super().__init__(db_path, schema=schema)

    def open_db(self):
        conn = super().open_db()

        # Use the fastest sync mode for the main DB.  This data is only a cache, so we don't care
        # # that much# if it loses data during a power loss.  Use normal sync for the user DB.
        conn.execute(f'PRAGMA {self.schema}.synchronous = OFF;')

        # Do first-time initialization and any migrations.
        self.upgrade(conn=conn)

        # Attach the user database.
        self.user_data.attach(conn)

        return conn

    def upgrade(self, *, conn):
        """
        Create and apply migrations to the file database.
        """
        with conn:
            # If there's no info table, start by just creating it at version 0, so _get_info
            # and _set_info work.
            if 'info' not in self.get_tables(conn):
                with transaction(conn):
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.info(
                            id INTEGER PRIMARY KEY,
                            version,
                            last_updated_at NOT NULL
                        )
                    ''')
                    conn.execute(f'INSERT INTO {self.schema}.info (id, version, last_updated_at) values (1, ?, 0)', (0,))

            if self.get_db_version(conn=conn) == 0:
                with transaction(conn):
                    self.set_db_version(1, conn=conn)
                
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.files(
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
                            directory_thumbnail_path
                        )
                    ''')

                    conn.execute(f'CREATE INDEX {self.schema}.files_path on files(lower(path))')
                    conn.execute(f'CREATE INDEX {self.schema}.files_parent on files(lower(parent))')
                    conn.execute(f'CREATE INDEX {self.schema}.files_file_id on files(inode, volume_id)')

                    # This should be searched with:
                    #
                    # SELECT * from file_tags WHERE LOWER(tag) GLOB "pattern*";
                    #
                    # for the best chance that the search can use the tag index.
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.file_keywords(
                            file_id NOT NULL,
                            keyword NOT NULL,
                            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                        )
                    ''')
                    conn.execute(f'CREATE INDEX {self.schema}.file_keyords_file_id on file_keywords(file_id)')
                    conn.execute(f'CREATE INDEX {self.schema}.file_keywords_keyword on file_keywords(lower(keyword))')

        assert self.get_db_version(conn=conn) == 1

    # Helpers for the file index:
    def get_last_update_time(self, conn=None):
        return self._get_info(conn=conn)['last_updated_at']
    def set_last_update_time(self, value, conn=None):
        self._set_info('last_updated_at', value, conn=conn)

    @classmethod
    def split_keywords(self, filename):
        keywords = re.split(r'([a-z0-9]+)', filename, flags=re.IGNORECASE)
        keywords = { keyword.strip() for keyword in keywords }
        keywords -= { '.', '' }
        return keywords

    def add_record(self, entry, conn=None):
        """
        Add or update a file record.  Set entry['id'] to the new or updated record's
        ID.

        If a record for this path already exists, it will be replaced.
        """
        with self.connect(conn) as cursor:
            fields = list(entry.keys())

            # These fields are included in the keyword index.
            keyword_fields = ('path', 'tags', 'title', 'comment', 'author')

            # See if this file already exists in the database.
            query = f"""
                SELECT *
                FROM {self.schema}.files
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
                query = f'''
                    UPDATE {self.schema}.files
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

                query = f'''
                    INSERT OR REPLACE INTO {self.schema}.files
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
                cursor.execute(f'DELETE FROM {self.schema}.file_keywords WHERE file_id = ?', [entry['id']])

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

                cursor.executemany(f'''
                    INSERT INTO {self.schema}.file_keywords (file_id, keyword) values (?, ?)
                ''', keywords_to_add)

        return entry

    def delete_recursively(self, paths, *, conn=None):
        """
        Remove a list of file paths from the database.

        If this includes directories, all entries for files inside the directory
        will be removed recursively.
        """
        with self.connect(conn) as cursor:
            # If path includes "/path", we need to delete "/path" and files matching
            # "/path/*", but not "/path*".
            path_list = [(str(path), str(path) + os.path.sep + '*') for path in paths]
            count = cursor.connection.total_changes
            cursor.executemany(f'''
                DELETE FROM {self.schema}.files
                WHERE
                    LOWER(files.path) = LOWER(?) OR
                    LOWER(files.path) GLOB LOWER(?)
            ''', path_list)
            deleted = cursor.connection.total_changes - count
            # print('Deleted %i (%s)' % (deleted, paths))

    def rename(self, old_path, new_path, *, conn=None):
        """
        Rename files from old_path to new_path.

        This is done when we detect a filesystem rename.
        """
        with self.connect(conn) as cursor:
            # Update "path" and "parent" for old_path and all files inside it.
            print('Renaming "%s" -> "%s"' % (old_path, new_path))

            # Do this for both the index and the user table.
            for schema in (self.schema, self.user_data.schema):
                for entry in self.search(path=str(old_path)):
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

                    query = f'''
                        UPDATE {schema}.files
                            SET path = ?, parent = ?
                            WHERE id = ?
                    ''' % {
                        'path': '',
                        'parent': '',
                    }
                    cursor.execute(query, [str(entry_new_path), str(entry_new_parent), entry['id']])

    def get(self, path, *, include_bookmark_info=True, conn=None):
        """
        Return the entry for the given path, or None if it doesn't exist.

        This is just a wrapper for search.
        """
        for result in self.search(path=path, mode=self.SearchMode.Exact, include_bookmark_info=include_bookmark_info):
            return result

        return None

    class SearchMode(Enum):
        Recursive = 1,
        Subdir = 2,
        Exact = 3,

    def search(self, *,
        path=None,

        # SearchMode.Recursive: Search recursively starting at path.
        # SearchMode.Subdir: List the contents of path non-recursively.
        # SearchMode.Exact: Return path.
        mode=SearchMode.Recursive,

        substr=None,

        # If true, only return bookmarked files.  Searching for unbookmarked files
        # isn't supported.
        bookmarked=False,

        # This can be an array of bookmark tags to filter for.  Implies bookmarked.
        bookmark_tags=None,

        include_bookmark_info=True,
        include_files=True, include_dirs=True
    ):
        if bookmark_tags:
            bookmarked = True
        if bookmarked and bookmark_tags is None:
            bookmark_tags = []

        with self.connect() as cursor:
            select_columns = []
            where = []
            params = []
            joins = []

            select_columns.append('files.*')

            if path is not None:
                if mode == self.SearchMode.Recursive:
                    # path is the top directory to start searching from.  This is done with a
                    # prefix match against the path: listing "C:\ABCD" recursively matches "C:\ABCD\*".
                    where.append(f'lower({self.schema}.files.path) GLOB lower(?)')
                    params.append(path + os.path.sep + '*')
                elif mode == self.SearchMode.Subdir:
                    # Only list files directly inside path.
                    where.append(f'lower({self.schema}.files.parent) = lower(?)')
                    params.append(path)
                elif mode == self.SearchMode.Exact:
                    # Only list path itself.
                    where.append(f'lower({self.schema}.files.path) = lower(?)')
                    params.append(path)
                else:
                    assert False

            if not include_files:
                where.append(f'{self.schema}.files.is_directory')
            if not include_dirs:
                where.append(f'not {self.schema}.files.is_directory')

            if bookmarked or include_bookmark_info:
                # Join to the user data table to search for bookmarks.  Bookmarks are by
                # path, not by ID.  Left join the bookmark constrains, so this doesn't filter
                # out unbookmarked files.  If we want that, we'll do it below in the
                # user_files.bookmarked filter.
                joins.append(f'''
                    LEFT JOIN {self.user_data.schema}.files AS user_files
                    ON lower(user_files.path) = lower({self.schema}.files.path)
                ''')
                
                if bookmarked:
                    where.append(f'user_files.bookmarked')

                # If we're searching bookmark tags, join the bookmark tag table.
                if bookmark_tags or include_bookmark_info:
                    joins.append(f'''
                        LEFT JOIN {self.user_data.schema}.bookmark_tags
                        ON {self.user_data.schema}.bookmark_tags.bookmark_id = user_files.user_file_id
                    ''')

                # Add each tag.
                if bookmark_tags and False:
                    for tag in bookmark_tags:
                        where.append(f'lower({self.user_data.schema}.bookmark_tags.tag) = lower(?)')
                        params.append(tag)
            
                # If the caller wants bookmark info, add it to the results.
                if include_bookmark_info:
                    select_columns.append('user_files.user_file_id AS user_file_id')
                    select_columns.append('user_files.bookmarked')
                    select_columns.append('user_files.bookmark_tags')

            # XXX: very slow for multiple keywords: slower for multiple, should be faster
            # might be faster to only search for one keyword, then do the rest from the tag list
            # or search for keywords first, group them manually, then grab the files
            if substr:
                for word_idx, word in enumerate(self.split_keywords(substr)):
                    # Each keyword match requires a separate join.
                    alias = 'keyword%i' % word_idx
                    joins.append(f'JOIN {self.schema}.file_keywords AS %s' % alias)
                    where.append('files.id = %s.file_id' % alias)

                    where.append('lower(%s.keyword) GLOB lower(?)' % alias)
                    params.append(word)

            where = ('WHERE ' + ' AND '.join(where)) if where else ''
            joins = (' '.join(joins)) if joins else ''

            query = f"""
                SELECT {', '.join(select_columns)}
                FROM {self.schema}.files AS files
                {joins}
                {where}
            """
#            print(query)
#            for row in cursor.execute('EXPLAIN QUERY PLAN ' + query, params):
#                result = dict(row)
#                print('plan:', result)

            for row in cursor.execute(query, params):
                result = dict(row)
                yield result

async def test():
    try:
        os.unlink('test.sqlite')
    except FileNotFoundError:
        pass

    try:
        os.unlink('user.sqlite')
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
