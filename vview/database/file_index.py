import asyncio, os, re
from enum import Enum
from pathlib import Path
from .database import Database, transaction
from pprint import pprint
from ..util import misc
from ..util.misc import WithBuilder

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

        # Make LIKE case-sensitive.
        #
        # SQLite's built-in case-insensitivity isn't very useful, since it only works for ASCII,
        # and some queries expect case-insensitive LIKE, such as delete_recursively, where it's
        # required for the files_path index to be used.
        conn.execute(f'PRAGMA {self.schema}.case_sensitive_like = ON;')

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
                            version
                        )
                    ''')
                    conn.execute(f'INSERT INTO {self.schema}.info (id, version) values (1, ?)', (0,))

            if self.get_db_version(conn=conn) == 0:
                with transaction(conn):
                    self.set_db_version(1, conn=conn)
                
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.files(
                            id INTEGER PRIMARY KEY,
                            populated NOT NULL DEFAULT true,
                            mtime NOT NULL,
                            ctime NOT NULL,
                            filesystem_mtime NOT NULL,
                            path UNIQUE NOT NULL,
                            parent NOT NULL,

                            -- The basename of the path, in lowercase.  This is for the 'normal' sort order. 
                            filesystem_name NOT NULL,

                            -- This is true for ZIPs, which we treat like directories.
                            is_directory NOT NULL DEFAULT false,

                            width,
                            height,
                            aspect_ratio, -- width / height
                            tags NOT NULL,
                            title NOT NULL,
                            comment NOT NULL,
                            mime_type NOT NULL,
                            author NOT NULL,
                            bookmarked NOT NULL DEFAULT FALSE,
                            bookmark_tags NOT NULL DEFAULT "",
                            directory_thumbnail_path,
                            codec,
                            animation NOT NULL DEFAULT FALSE,

                            -- If the image is cropped, a JSON array of crop data.
                            crop,

                            -- The slideshow pan as a JSON array, if any.
                            pan,

                            -- The current inpaint data, its filename ID and timestamp.
                            inpaint,
                            inpaint_id,
                            inpaint_timestamp DEFAULT 0 NOT NULL,

                            -- If this is a video or an animation, this is the duration in seconds if known.
                            duration
                        )
                    ''')

                    conn.execute(f'CREATE INDEX {self.schema}.files_path on files(path)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_parent on files(parent)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_mime_type on files(mime_type)')
                    conn.execute(f'CREATE INDEX {self.schema}.files_animation on files(animation) WHERE animation')
                    conn.execute(f'CREATE INDEX {self.schema}.files_bookmarked on files(bookmarked) WHERE bookmarked')

                    # This index is for the "normal" sort order.  See library.sort_orders.
                    conn.execute(f'CREATE INDEX {self.schema}.files_sort_normal on files(is_directory DESC, filesystem_name ASC)')

                    # This is used to find untagged bookmarks.  Tag searches use the bookmark_tag table below.
                    conn.execute(f'CREATE INDEX {self.schema}.files_untagged_bookmarks on files(bookmark_tags) WHERE bookmark_tags == "" AND bookmarked')

                    # This should be searched with:
                    #
                    # SELECT * from file_tags WHERE tag LIKE "pattern%";
                    #
                    # for the best chance that the search can use the tag index.
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.file_keywords(
                            file_id NOT NULL,
                            keyword TEXT NOT NULL,
                            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                        )
                    ''')
                    conn.execute(f'CREATE INDEX {self.schema}.file_keyords_file_id on file_keywords(file_id)')
                    conn.execute(f'CREATE INDEX {self.schema}.file_keywords_keyword on file_keywords(keyword)')

                    # This should be searched with:
                    #
                    # SELECT * from bookmark_tags WHERE tag LIKE "pattern%";
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
                    conn.execute(f'CREATE INDEX {self.schema}.bookmark_tags_tag on bookmark_tags(tag)')

        assert self.get_db_version(conn=conn) == 1

    @classmethod
    def split_keywords(self, filename):
        return set(misc.split_keywords(filename))

    @property
    def keyword_fields(self):
        """
        Return entry fields which are included in the keyword index.
        """
        return 'path', 'tags', 'title', 'comment', 'author'

    def get_keywords_for_entry(self, entry):
        keywords = set()
        for keyword_field in self.keyword_fields:
            if keyword_field == 'path':
                keywords |= self.split_keywords(os.path.basename(entry['path']))
            else:
                keywords |= self.split_keywords(entry[keyword_field])
        return keywords

    def add_record(self, entry, *, conn=None):
        """
        Add or update a file record.  Set entry['id'] to the new or updated record's
        ID.

        If a record for this path already exists, it will be replaced.
        """
        # We're going to read the database and then probably write a record.  Try to open
        # a write transaction from the start, which prevents "database locked" errors if
        # the database is modified between the read and the write.  This won't do anything
        # if we already have a connection.
        with self.cursor(conn, write=True) as cursor:
            fields = list(entry.keys())

            # These fields are included in the keyword index.
            keyword_fields = self.keyword_fields

            # See if this file already exists in the database.
            query = f"""
                SELECT *
                FROM {self.schema}.files
                WHERE path = ?
                """
            result = list(cursor.execute(query, (entry['path'],)))
            existing_record = result[0] if result else None

            if existing_record:
                # The record already exists.  Update all fields except for path, parent, and
                # filesystem_name name, which are invariant (except for renames which we don't
                # do here)  This is much faster than letting INSERT OR REPLACE replace the record.
                fields.remove('path')
                fields.remove('parent')
                fields.remove('filesystem_name')
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

                keywords = self.get_keywords_for_entry(entry)

                keywords_to_add = []
                for keyword in keywords:
                    keywords_to_add.append((entry['id'], keyword.lower()))

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
                    tags_to_add.append((entry['id'], tag.lower()))

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
            # "/path/%", but not "/path%".
            path_list = [(str(path), self.escape_like(str(path)) + os.path.sep + '%') for path in paths]
            count = cursor.connection.total_changes
            cursor.executemany(f'''
                DELETE FROM {self.schema}.files
                WHERE
                    files.path = ? OR
                    files.path LIKE ? ESCAPE "$"
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
            
            for entry in self.search(paths=[str(old_path)], conn=conn):
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

                entry_new_filesystem_name = new_path.name.lower()

                query = f'''
                    UPDATE OR REPLACE {self.schema}.files
                        SET path = ?, parent = ?, filesystem_name = ?
                        WHERE id = ?
                ''' % {
                    'path': '',
                    'parent': '',
                }
                cursor.execute(query, [
                    str(entry_new_path),              # path
                    str(entry_new_parent),            # parent
                    str(entry_new_filesystem_name),   # filesystem_name
                    entry['id'],                      # WHERE id
                ])

    def get(self, path, *, conn=None):
        """
        Return the entry for the given path, or None if it doesn't exist.

        This is just a wrapper for search.
        """
        for result in self.search(paths=[path], mode=self.SearchMode.Exact, conn=conn):
            return result

        return None

    class SearchMode(Enum):
        Recursive = 1,
        Subdir = 2,
        Exact = 3,

    def search(self, *,
        paths=None,

        # SearchMode.Recursive: Search recursively starting at path.
        # SearchMode.Subdir: List the contents of path non-recursively.
        # SearchMode.Exact: Return path.
        mode=SearchMode.Recursive,

        substr=None,

        # "images" or "videos":
        media_type=None,

        # If set, return only bookmarked or unbookmarked files.
        bookmarked=None,

        # If set, this is an array of bookmark tags to filter for.  bookmarked must be true
        # for this to be used.
        bookmark_tags=None,

        # Only match images with width*height >= total_pixels.  If negative,
        # match images with width*height <= -total_pixels.
        total_pixels=None,

        # Only match images with aspect_ratio[0] <= width / height >= aspect_ratio[1].
        aspect_ratio=None,

        # An SQL ORDER BY statement to order results.  See library.sort_orders.
        order=None,

        # By default, all filters must match for us to return a file.  If available_fields
        # is set, it's a list of keys in the entry which are available, and only search
        # filters whose required fields are present will be used.  For example, if
        # available_fields doesn't include 'width', the total_pixels filter will be ignored.
        #
        # This is used for early filtering with unpopulated entries, so we can filter out
        # as many search results as possible using just filesystem data before spending time
        # loading the file's metadata.
        available_fields=None,

        # If set, this is a (with_statement, params) tuple, which will be used as the
        # source for the search instead of the database.
        source=None,

        include_files=True, include_dirs=True,
        debug=False,
        conn=None
    ):
        # If available_fields was supplied, disable searches that require unavailable
        # fields.
        if available_fields is not None:
            if 'width' not in available_fields or 'height' not in available_fields:
                total_pixels = None
                aspect_ratio = None

            # Video searches require the animation field.
            if media_type == 'videos' and 'animation' not in available_fields:
                media_type = None

        select_columns = []
        where = []
        params = []
        joins = []
        with_prefix = ''

        select_columns.append('files.*')
        if source is None:
            schema = f'{self.schema}.'
        else:
            with_prefix, source_params = source
            params.extend(source_params)
            schema = ''

        if paths:
            path_conds = []
            for path in paths:
                if mode == self.SearchMode.Recursive:
                    # paths are top directories to start searching from.  This is done with a
                    # prefix match against the path: listing "C:\ABCD" recursively matches "C:\ABCD\*".
                    # Directories don't end in a slash, so Include the directory itself explicitly.
                    path_conds.append(f'({schema}files.path LIKE ? ESCAPE "$" OR {schema}files.path = ?)')
                    params.append(self.escape_like(path) + os.path.sep + '%')
                    params.append(path)
                elif mode == self.SearchMode.Subdir:
                    # Only list files directly inside path.
                    path_conds.append(f'{schema}files.parent = ?')
                    params.append(path)
                elif mode == self.SearchMode.Exact:
                    # Only list path itself.
                    path_conds.append(f'{schema}files.path = ?')
                    params.append(path)
                else:
                    assert False

            assert path_conds
            where.append(f"({' OR '.join(path_conds)})")

        if not include_files:
            where.append(f'{schema}files.is_directory')
        if not include_dirs:
            where.append(f'not {schema}files.is_directory')
        if media_type is not None:
            assert media_type in ('videos', 'images')

            if media_type == 'videos':
                # Include animation, so searching for videos includes animated GIFs.
                where.append(f'({schema}mime_type LIKE "video/%" OR {schema}animation)')
            elif media_type == 'images':
                where.append(f'{schema}mime_type LIKE "image/%"')

        if total_pixels is not None:
            # Minimum total pixels:
            if total_pixels[0] is not None:
                where.append(f'{schema}width*{schema}height >= ?')
                params.append(total_pixels[0])

            # Maximum total pixels:
            if total_pixels[1] is not None:
                where.append(f'{schema}width*{schema}height <= ?')
                params.append(total_pixels[1])

        if aspect_ratio is not None:
            # Minimum aspect ratio:
            if aspect_ratio[0] is not None:
                where.append(f'{schema}width/{schema}height >= ?')
                params.append(aspect_ratio[0])

            # Maximum aspect ratio:
            if aspect_ratio[1] is not None:
                where.append(f'{schema}width/{schema}height <= ?')
                params.append(aspect_ratio[1])

        if bookmarked is not None:
            if bookmarked:
                where.append(f'{schema}files.bookmarked')
            else:
                where.append(f'not {schema}files.bookmarked')

            # If we're searching bookmark tags, join the bookmark tag table.  Note that
            # a blank value of bookmark_tags means 
            if bookmark_tags is not None:
                if bookmark_tags == '':
                    # Search for untagged bookmarks using the files_untagged_bookmarks index.
                    where.append(f'bookmark_tags == ""')
                    where.append(f'bookmarked')
                else:
                    joins.append(f'''JOIN {schema}bookmark_tags ON {schema}bookmark_tags.file_id = {schema}files.id''')

                    # Add each tag.
                    tag_match = []
                    for tag in bookmark_tags.split(' '):
                        tag_match.append(f'{schema}bookmark_tags.tag = ?')
                        params.append(tag.lower())
                    where.append('(' + ' OR '.join(tag_match) + ')')
        
        if substr:
            for word_idx, word in enumerate(self.split_keywords(substr)):
                # Each keyword match requires a separate join.
                alias = 'keyword%i' % word_idx
                joins.append(f'''JOIN {schema}file_keywords AS {alias} ON files.id = {alias}.file_id''')

                # Use a prefix match, which can still use the keyword index.
                where.append('%s.keyword GLOB ?' % alias)
                params.append(word.lower() + '*')

        if order is None:
            order = ''

        where = ('WHERE\n' + ' AND\n'.join(where)) if where else ''
        joins = ('\n'.join(joins)) if joins else ''

        query = f"""
            {with_prefix}
            SELECT {', '.join(select_columns)}
            FROM {schema}files AS files
            {joins}
            {where}
            {order}
        """
        with self.cursor(conn) as cursor:
            if debug:
                print(query)
                print(params)
                for row in cursor.execute('EXPLAIN QUERY PLAN ' + query, params):
                    result = dict(row)
                    print('plan:', result)

            for row in cursor.execute(query, params):
                result = dict(row)
                try:
                    yield result
                except GeneratorExit:
                    # GeneratorExit is normal.  Return rather than raising it to commit
                    # the transaction.
                    return

    def entry_matches_search(self, entry, conn=None, incomplete=False, **search_options):
        """
        Return true if the given entry matches the search options.  The entry doesn't
        need to be in the database.

        If incomplete is true and entry is unpopulated, do as much filtering as possible
        with the data available.  If a search filter can't be performed because entry
        doesn't have the data yet, we'll assume it matches.
        """
        # Create a WITH statement with the same schema as the "files" and "file_keywords"
        # table, containing just this record.
        params = []
        withs = []

        # If the entry has no ID, it doesn't actually exist in the database. Set a
        # dummy ID, since if we leave it null, it won't join.
        if 'id' not in entry:
            entry = { 'id': 'placeholder-id' } | entry

        # Add the files table.
        field_names = list(entry.keys())
        fields = [entry[field] for field in field_names]

        file_with = WithBuilder(*field_names, table_name='files')
        file_with.add_row(*fields)
        file_with.get_params(params)
        withs.append(file_with.get())

        # Add the file_keywords table.
        keywords = self.get_keywords_for_entry(entry)
        if keywords:
            keyword_with = WithBuilder('file_id', 'keyword', table_name='file_keywords')
        
            for keyword in keywords:
                keyword_with.add_row(entry['id'], keyword)
            keyword_with.get_params(params)
            withs.append(keyword_with.get())

        # Combine the result into a single WITH statement.
        source = f"""WITH {", ".join(withs)}"""

        # If incomplete matches are being allowed, tell search() which fields are
        # available.
        if incomplete:
            available_fields = [field for field in field_names if entry[field] is not None]
        else:
            available_fields = None

        # Search for the entry using this WITH statement.  If it returns it as a result, it
        # matches the search parameters.
        for entry in self.search(source=(source, params), available_fields=available_fields, **search_options, conn=conn):
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
        'filesystem_name': 'name',
        'mtime': 10,
        'ctime': 10,
        'filesystem_mtime': 10,
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
