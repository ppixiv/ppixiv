from .database import Database, transaction
from ..util import win32
from pprint import pprint
from collections import OrderedDict

class UserData(Database):
    def __init__(self, db_path, schema):
        super().__init__(db_path, schema=schema)

    def open_db(self):
        conn = super().open_db()

        conn.execute(f'PRAGMA {self.schema}.synchronous = NORMAL;')

        self.upgrade(conn=conn)

        return conn

    def upgrade(self, *, conn):
        """
        Create and apply migrations to the user database.
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
                            user_file_id INTEGER PRIMARY KEY,
                            path UNIQUE NOT NULL,
                            parent NOT NULL,
                            inode,
                            volume_id,
                            bookmarked NOT NULL DEFAULT FALSE,
                            bookmark_tags NOT NULL DEFAULT ""
                        )
                    ''')
                    conn.execute(f'CREATE INDEX {self.schema}.files_path on files(lower(path))')
                    conn.execute(f'CREATE INDEX {self.schema}.files_parent on files(lower(parent))')
                    conn.execute(f'CREATE INDEX {self.schema}.files_inode on files(inode, volume_id)')

                    # This should be searched with:
                    #
                    # SELECT * from bookmark_tags WHERE LOWER(tag) GLOB "pattern*";
                    #
                    # for the best chance that the search can use the tag index.
                    conn.execute(f'''
                        CREATE TABLE {self.schema}.bookmark_tags(
                            bookmark_id NOT NULL,
                            tag NOT NULL,
                            FOREIGN KEY(bookmark_id) REFERENCES files(user_file_id) ON DELETE CASCADE
                        )
                    ''')
                    conn.execute(f'CREATE INDEX {self.schema}.bookmark_tags_file_id on bookmark_tags(bookmark_id)')
                    conn.execute(f'CREATE INDEX {self.schema}.bookmark_tags_tag on bookmark_tags(lower(tag))')

    def bookmark_add(self, path, *, tags=None, conn=None):
        with self.connect(conn) as conn:
            query = f"SELECT * FROM {self.schema}.files WHERE path = ?"
            for row in conn.execute(query, [str(path)]):
                # Edit this bookmark.
                existing_bookmark_id = row['id']
                break
            else:
                existing_bookmark_id = None

    def bookmark_edit(self, *, path=None, bookmark_id=None, tags=None, conn=None):
        """
        Add or edit a bookmark.

        Bookmarks can exist for paths that don't currently exist, but can only be
        edited.  New bookmarks can only be created for files that exist.
        """
        # XXX: should be able to specify connect(conn, lock=True) to open a write
        # transaction immediately
        with self.connect(conn) as cursor:
            old_changes = cursor.connection.total_changes

            # See if this bookmark already exists.
            if bookmark_id is None:
                if path is None:
                    raise Exception('At least one of a bookmark ID or path must be specified')

                # We were given a path and no bookmark ID.  See if the path already
                # exist.
                query = f"SELECT * FROM {self.schema}.files WHERE path = ?"
                for row in cursor.execute(query, [str(path)]):
                    # Edit this bookmark.
                    bookmark_id = row['user_file_id']
                    break
                else:
                    # The ID doesn't exist, so we'll create it.
                    bookmark_id = None

            sets = OrderedDict()
            sets['bookmarked'] = True

            # If tags isn't specified, leave the existing tags unchanged.
            if tags is not None:
                sets['bookmark_tags'] = tags

            if bookmark_id is not None:
                query = f'''
                    UPDATE {self.schema}.files
                        SET {', '.join('%s = ?' % key for key in sets.keys())}
                        WHERE user_file_id = ?
                '''
                params = list(sets.values())
                params.append(bookmark_id)
            else:
                # Create a new bookmark.  This requires that the file exist, and path.stat()
                # will raise an exception if it doesn't.
                stat = path.stat()
        
                sets['path'] = str(path)
                sets['parent'] = str(path.parent)
                sets['inode'] = stat.st_ino
                sets['volume_id'] = win32.get_volume_serial_number(path)

                query = f'''
                    INSERT INTO {self.schema}.files
                        ({', '.join(sets.keys())})
                        VALUES ( {', '.join('?'*len(sets))} )
                '''
                params = list(sets.values())

            cursor.execute(query, params)

            # If this is a new record, grab the new ID.
            if bookmark_id is None:
                bookmark_id = cursor.lastrowid

            # Only update tags if needed.
            if tags is not None:
                # Delete old keywords.
                print(bookmark_id)
                cursor.execute(f'DELETE FROM {self.schema}.bookmark_tags WHERE bookmark_id = ?', [bookmark_id])

                # Split the tag list.
                keywords = set(tags.split(' '))
                if ' ' in keywords:
                    keywords.delete(' ')

                keywords_to_add = []
                for keyword in keywords:
                    keywords_to_add.append((bookmark_id, keyword))

                cursor.executemany(f'''
                    INSERT INTO {self.schema}.bookmark_tags (bookmark_id, tag) values (?, ?)
                ''', keywords_to_add)

        return cursor.connection.total_changes != old_changes, bookmark_id

    def bookmark_delete(self, bookmark_id, *, conn=None):
        """
        Delete a bookmark.  Return true if a bookmark was deleted.
        """
        # XXX: if we store other user data here, just change bookmarked to false rather
        # than deleting it
        with self.connect(conn) as cursor:
            old_changes = cursor.connection.total_changes
            query = f'''DELETE FROM {self.schema}.files WHERE user_file_id = ?'''
            cursor.execute(query, [bookmark_id])
            return cursor.connection.total_changes != old_changes

    def bookmark_get(self, bookmark_id=None, *, conn=None):
        """
        """
        with self.connect(conn) as cursor:
            query = f"""
                SELECT *
                FROM {self.schema}.files
                WHERE user_file_id = lower(?)
            """
            for row in cursor.execute(query, [bookmark_id]):
                row = dict(row)
                print('----->', row)
                return row
        
            return None