import asyncio, os, re
from enum import Enum
from pathlib import Path
from .database import Database, transaction
from pprint import pprint

# This implements the database storage for library.  It stores similar data to
# what we get from the Windows index.
class FileIndex(Database):
    def __init__(self, db_path, *, schema='files'):
        """
        db_path is the path to the database on the filesystem.
        """
        super().__init__(db_path, schema=schema)

    def open_db(self):
        conn = super().open_db()

        # Use the fastest sync mode.  This data is only a cache, so we don't care
        # that much if it loses data during a power loss.
        conn.execute(f'PRAGMA {self.schema}.synchronous = OFF;')

        # Do first-time initialization and any migrations.
        self.upgrade(conn=conn)

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
                            populated NOT NULL DEFAULT true,
                            mtime NOT NULL,
                            ctime NOT NULL,
                            path UNIQUE NOT NULL,
                            parent NOT NULL,
                            is_directory NOT NULL DEFAULT false,
                            width,
                            height,
                            tags NOT NULL,
                            title NOT NULL,
                            comment NOT NULL,
                            mime_type NOT NULL,
                            author NOT NULL,
                            bookmarked NOT NULL DEFAULT FALSE,
                            bookmark_tags NOT NULL DEFAULT "",
                            directory_thumbnail_path,
                            codec,
                            animation NOT NULL DEFAULT FALSE
                        )
                    ''')

                    conn.execute(f'CREATE INDEX {self.schema}.files_path on files(path)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_parent on files(parent)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_mime_type on files(mime_type)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_animation on files(animation) WHERE animation')

                    # This is used to find untagged bookmarks.  Tag searches use the bookmark_tag table below.
                    conn.execute(f'CREATE INDEX {self.schema}.files_untagged_bookmarks on files(bookmark_tags) WHERE bookmark_tags == "" AND bookmarked')

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

                    # This should be searched with:
                    #
                    # SELECT * from bookmark_tags WHERE LOWER(tag) GLOB "pattern*";
                    #
                    # for the best chance that the search can use the tag index.
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.bookmark_tags(
                            file_id NOT NULL,
                            tag NOT NULL,
                            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                        )
                    ''')
                    conn.execute(f'CREATE INDEX {self.schema}.bookmark_tags_file_id on bookmark_tags(file_id)')
                    conn.execute(f'CREATE INDEX {self.schema}.bookmark_tags_tag on bookmark_tags(lower(tag))')

        assert self.get_db_version(conn=conn) == 1

    # Helpers for the file index:
    def get_last_update_time(self, *, conn=None):
        return self._get_info(conn=conn)['last_updated_at']
    def set_last_update_time(self, value, *, conn=None):
        self._set_info('last_updated_at', value, conn=conn)

    @classmethod
    def split_keywords(self, filename):
        keywords = re.split(r'([a-z0-9]+)', filename, flags=re.IGNORECASE)
        keywords = { keyword.strip() for keyword in keywords }
        keywords -= { '.', '' }
        return keywords

    def add_record(self, entry, *, conn=None):
        """
        Add or update a file record.  Set entry['id'] to the new or updated record's
        ID.

        If a record for this path already exists, it will be replaced.
        """
        with self.cursor(conn) as cursor:
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
                        SET {', '.join(sets)}
                        WHERE path = ?
                '''
                cursor.execute(query, row)

                # If any field in keyword_fields has changed, we need to update the keyword index.
                keyword_update_needed = False
                for keyword_field in keyword_fields:
                    keyword_update_needed |= existing_record[keyword_field] != entry[keyword_field]

                # If the tag list changed, we need to update the tag index.
                tag_update_needed = existing_record['bookmark_tags'] != entry['bookmark_tags']
                
                # Set the ID in our caller's entry to the existing ID.
                entry['id'] = existing_record['id']
            else:
                # The record doesn't exist, so create a new one.
                keyword_update_needed = True

                # If this entry is bookmarked, update its tag index.  Since this is a new entry,
                # we can skip this if it's not bookmarked.
                tag_update_needed = entry['bookmarked']

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

            # Update search keywords if needed.
            if keyword_update_needed:
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

            # Update tags if needed.
            if tag_update_needed:
                # Delete old tags.
                cursor.execute(f'DELETE FROM {self.schema}.bookmark_tags WHERE file_id = ?', [entry['id']])

                # Split the tag list.
                tags = set(entry['bookmark_tags'].split(' '))
                if '' in tags:
                    tags.remove('')

                tags_to_add = []
                for tag in tags:
                    tags_to_add.append((entry['id'], tag))

                cursor.executemany(f'''
                    INSERT INTO {self.schema}.bookmark_tags (file_id, tag) values (?, ?)
                ''', tags_to_add)

        return entry

    def delete_recursively(self, paths, *, conn=None):
        """
        Remove a list of file paths from the database.

        If this includes directories, all entries for files inside the directory
        will be removed recursively.
        """
        with self.cursor(conn) as cursor:
            # If path includes "/path", we need to delete "/path" and files matching
            # "/path/*", but not "/path*".
            path_list = [(str(path), str(path) + os.path.sep + '*') for path in paths]
            count = cursor.connection.total_changes
            cursor.executemany(f'''
                DELETE FROM {self.schema}.files
                WHERE
                    files.path = ? OR
                    files.path GLOB ?
            ''', path_list)
            deleted = cursor.connection.total_changes - count
            # print('Deleted %i (%s)' % (deleted, paths))

    def rename(self, old_path, new_path, *, conn=None):
        """
        Rename files from old_path to new_path.

        This is done when we detect a filesystem rename.
        """
        with self.cursor(conn) as cursor:
            # Update "path" and "parent" for old_path and all files inside it.
            print('Renaming "%s" -> "%s"' % (old_path, new_path))
            old_path = Path(old_path)
            new_path = Path(new_path)

            if old_path == new_path:
                return
                
            # Make sure the old path doesn't exist.  We could use UPDATE OR REPLACE
            # below, but that would only remove conflicting files.  If the new path
            # exists in the database, the entire directory is stale and should be
            # removed.
            self.delete_recursively([new_path], conn=conn)

            for entry in self.search(path=str(old_path), conn=conn):
                # path should always be relative to old_path: this is a path inside
                # the path we searched for.
                path = Path(entry['path'])
                relative_path = path.relative_to(old_path)
                entry_new_path = new_path / relative_path

                # parent should always be inside old_path, unless this is old_path itself.
                if path != old_path:
                    relative_parent = Path(entry['parent']).relative_to(old_path)
                    entry_new_parent = new_path / relative_parent
                else:
                    entry_new_parent = entry['parent']

                query = f'''
                    UPDATE OR REPLACE {self.schema}.files
                        SET path = ?, parent = ?
                        WHERE id = ?
                ''' % {
                    'path': '',
                    'parent': '',
                }
                cursor.execute(query, [str(entry_new_path), str(entry_new_parent), entry['id']])

    def get(self, path, *, conn=None):
        """
        Return the entry for the given path, or None if it doesn't exist.

        This is just a wrapper for search.
        """
        for result in self.search(path=path, mode=self.SearchMode.Exact, conn=conn):
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

        # "images" or "videos":
        media_type=None,

        # If set, return only bookmarked or unbookmarked files.
        bookmarked=None,

        # If set, this is an array of bookmark tags to filter for.
        bookmark_tags=None,

        # If set, only match this exact file ID in the database.  This is used to
        # check if a loaded entry matches other search filters.
        file_id=None,

        include_files=True, include_dirs=True,
        conn=None
    ):
        with self.cursor(conn) as cursor:
            select_columns = []
            where = []
            params = []
            joins = []

            select_columns.append('files.*')

            if path is not None:
                if mode == self.SearchMode.Recursive:
                    # path is the top directory to start searching from.  This is done with a
                    # prefix match against the path: listing "C:\ABCD" recursively matches "C:\ABCD\*".
                    # Directories don't end in a slash, so Include the directory itself explicitly.
                    where.append(f'({self.schema}.files.path GLOB ? OR {self.schema}.files.path = ?)')
                    params.append(path + os.path.sep + '*')
                    params.append(path)
                elif mode == self.SearchMode.Subdir:
                    # Only list files directly inside path.
                    where.append(f'{self.schema}.files.parent = ?')
                    params.append(path)
                elif mode == self.SearchMode.Exact:
                    # Only list path itself.
                    where.append(f'{self.schema}.files.path = ?')
                    params.append(path)
                else:
                    assert False

            if not include_files:
                where.append(f'{self.schema}.files.is_directory')
            if not include_dirs:
                where.append(f'not {self.schema}.files.is_directory')
            if media_type is not None:
                assert media_type in ('videos', 'images')

                if media_type == 'videos':
                    # Include animation, so searching for videos includes animated GIFs.
                    where.append(f'({self.schema}.mime_type GLOB "video/*" OR animation)')
                elif media_type == 'images':
                    where.append(f'{self.schema}.mime_type GLOB "image/*"')

            if file_id is not None:
                where.append(f'{self.schema}.files.id = ?')
                params.append(file_id)

            if bookmarked is not None:
                if bookmarked:
                    where.append(f'{self.schema}.files.bookmarked')
                else:
                    where.append(f'not {self.schema}.files.bookmarked')

                # If we're searching bookmark tags, join the bookmark tag table.  Note that
                # a blank value of bookmark_tags means 
                if bookmark_tags is not None:
                    if bookmark_tags == '':
                        # Search for untagged bookmarks using the files_untagged_bookmarks index.
                        where.append(f'bookmark_tags == ""')
                        where.append(f'bookmarked')
                    else:
                        joins.append(f'''
                            LEFT JOIN {self.schema}.bookmark_tags
                            ON {self.schema}.bookmark_tags.file_id = {self.schema}.files.id
                        ''')

                        # Add each tag.
                        for tag in bookmark_tags.split(' '):
                            where.append(f'lower({self.schema}.bookmark_tags.tag) = lower(?)')
                            params.append(tag)
            
            if substr:
                for word_idx, word in enumerate(self.split_keywords(substr)):
                    # Each keyword match requires a separate join.
                    alias = 'keyword%i' % word_idx
                    joins.append(f'JOIN {self.schema}.file_keywords AS %s' % alias)
                    where.append('files.id = %s.file_id' % alias)

                    # We need to lowercase the string ourself and not say "GLOB lower(?)" for this
                    # to use the keyword index.
                    where.append('lower(%s.keyword) GLOB ?' % alias)
                    params.append(word.lower())

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

    def id_matches_search(self, file_id, conn=None, **search_options):
        """
        Return true if the given file ID matches the search options.
        """
        for entry in self.search(file_id=file_id, **search_options, conn=conn):
            return True
        return False

    def get_all_bookmark_tags(self, *, conn=None):
        """
        Return a list of all bookmark tags.
        """
        with self.cursor(conn) as cursor:
            # Get tag counts:
            results = {}
            query = f"""
                SELECT tag, count(tag) FROM bookmark_tags
                GROUP BY tag
            """
            for row in cursor.execute(query):
                print(row.keys())
                tag = row['tag']
                results[tag] = row['count(tag)']

            # Get the number of untagged bookmarks.  This search uses the files_untagged_bookmarks
            # index.
            query = f"""
                SELECT count(*) FROM files
                WHERE bookmark_tags == "" AND bookmarked
            """
            for row in cursor.execute(query):
                results[''] = row['count(*)']

            return results

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

        'populated': True,
        'mtime': 10,
        'ctime': 10,
        'is_directory': True,
        'width': 'a',
        'height': 'a',
        'tags': '',
        'title': '',
        'comment': '',
        'mime_type': '',
        'author': '',
        'directory_thumbnail_path': None,
        'bookmarked': False,
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
    assert Path(db.get(str(path))['path']) == path, entry
    assert Path(db.get(str(path2))['parent'])  == path, entry

    # Test deleting the tree.
    db.delete_recursively([str(path)])
    assert db.get(str(path)) is None, entry
    assert db.get(str(path2)) is None, entry

    # Add directories again.  Add a third unrelated directory that we'll test to
    # be sure it's unaffected by the rename.
    db.add_record(path_record(path))
    db.add_record(path_record(path2))
    path3 = Path('f:/unrelated')
    db.add_record(path_record(path3))

    # Rename f:/foo to f:/test.  This will affect entry and entry2.
    db.rename(str(path), str(Path('f:/test')))

    # Test that the entries have been renamed correctly.
    assert db.get(str(path)) is None, entry
    assert db.get(str(path2)) is None, entry
    assert db.get(str(path3)) is not None, entry
    new_entry = db.get(str(Path('f:/test')))
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
