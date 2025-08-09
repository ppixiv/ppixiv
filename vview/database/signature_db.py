# The signatures database holds ImageSignatures for images we've computed a
# signature for.
#
# This could be a field in FileIndex, but there are advantages to having it in
# a separate database:
#
# - We store this for every file we thumbnail.  The main cost of doing this is
# decoding the image in the first place, so it's cheapest to just do it when we
# already have the image decoded.  This happens whether the image is bookmarked
# or not, so putting it in a separate db avoids bloating the main file index with
# every image that's been viewed.
# - It's convenient to be able to wipe the main database and recreate it, but it
# would be a pain to lose all computed signatures too, since recomputing those takes
# much longer than populating the index.
#
# Our IDs are the ones we load into ImageIndex.
#
# We don't share IDs with file_index, and there's no foreign key relationship since
# we're in a separate database.  We just use the path to match them up.
import asyncio, logging, sqlite3, io
from .database import Database, transaction
from ..util import image_index, misc
from PIL import Image
from ..util.tiff import remove_photoshop_tiff_data
from pprint import pprint

log = logging.getLogger(__name__)

# This implements the database storage for library.  It stores similar data to
# what we get from the Windows index.
class SignatureDB(Database):
    def __init__(self, db_path, *, schema='signatures'):
        super().__init__(db_path, schema=schema)
        self.image_index = image_index.ImageIndex()

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
                        CREATE TABLE {self.schema}.signatures(
                            id INTEGER PRIMARY KEY,
                            mtime NOT NULL,
                            path UNIQUE NOT NULL,

                            -- An ImageIndex signature if we've computed one for this image.
                            signature BLOB
                        )
                    ''')

                    conn.execute(f'CREATE INDEX {self.schema}.signatures_path on signatures(path)')

        assert self.get_db_version(conn=conn) == 1

    async def load_image_index(self):
        """
        Load the image index with saved signatures.
        """
        if not image_index.available:
            return

        log.info('Loading image signatures...')
        idx = 0
        for idx, sig_entry in enumerate(self.all_signatures()):
            signature = image_index.ImageSignature(sig_entry['signature'])
            self.image_index.add_image(sig_entry['id'], signature)

            # Yield periodically to let other things happen.
            if (idx % 10) == 0:
                await asyncio.sleep(0)

        log.info(f'Loaded {idx} image signatures')

    def get_from_ids(self, ids, *, conn=None):
        id_params = ['?'] * len(ids)
        query = f"""
            SELECT *
            FROM {self.schema}.signatures AS signatures
            WHERE id in ({', '.join(id_params)})
        """
        with self.cursor(conn) as cursor:
            for row in cursor.execute(query, ids):
                yield row

        return None

    def get_from_path(self, path, *, conn=None):
        """
        Return the entries for the given path, or None if it doesn't exist.
        """
        path = str(path)

        query = f"""
            SELECT *
            FROM {self.schema}.signatures AS signatures
            WHERE path = ?
        """
        with self.cursor(conn) as cursor:
            for row in cursor.execute(query, [path]):
                result = dict(row)
                return result

        return None

    def get(self, path, *, conn=None):
        """
        Return the entries for the given path, or None if it doesn't exist.
        """
        results = self.get_multi([path], conn=conn)
        if not results:
            return None

        assert len(results) == 1
        return results[0]

    def all_signatures(self, *, conn=None):
        """
        Yield all (path, signature) entries.
        """
        query = f"""
            SELECT id, path, signature
            FROM {self.schema}.signatures AS signatures
        """
        with self.cursor(conn) as cursor:
            for row in cursor.execute(query, []):
                result = dict(row)
                yield result

    def set_signature(self, path, signature, mtime, *, conn=None):
        """
        Set the signature for an entry.  Return the row's ID.
        """
        signature = sqlite3.Binary(signature)
        with self.cursor(conn, write=True) as cursor:
            query = f'''
                INSERT OR REPLACE INTO {self.schema}.signatures
                (path, mtime, signature)
                VALUES (?, ?, ?)
            '''
            cursor.execute(query, [str(path), mtime, signature])
            return cursor.lastrowid

    def get_image_signature(self, path, create=True):
        """
        Return an ImageSignature for an image, creating it if needed.  If image indexing
        isn't available or the image can't be read, return None.
        """
        if not image_index.available:
            return None

        # Check if this path is already cached.
        sig_entry = self.get_from_path(path)
        if sig_entry is not None:
            return image_index.ImageSignature(sig_entry['signature'])

        if not create:
            return None

        # Read the image to create the signature.
        with path.open('rb') as f:
            try:
                f = remove_photoshop_tiff_data(f)
                image = Image.open(f)
                return self.save_image_signature(path, image)

            except Exception as e:
                log.warn('Couldn\'t read %s to create thumbnail: %s' % (path, e))
                return None

    def save_image_signature(self, path, image):
        """
        Save the signature for an image.

        This is called when we've decoded the image already for some other reason, like
        generating thumbnails, so we can store the signature without doing much extra work.
        """
        # The time we'll store with the signature.  Use the filesystem time, so if this
        # is inside a ZIP, this is the mtime of the ZIP.
        filesystem_mtime = path.filesystem_file.stat().st_mtime

        # See if we already have the signature for this image.
        sig_entry = self.get_from_path(path)
        if sig_entry is not None:
            # Check the mtime, so we update the signature if the mtime changes.
            mtime_difference = abs(sig_entry['mtime'] - filesystem_mtime)
            if mtime_difference < 0.1:
                return

        # Create the signature.
        signature = image_index.ImageSignature.from_image(image)

        # Store the signature to the database.
        sig_id = self.set_signature(path, bytes(signature), filesystem_mtime)

        # Add the signature to the image index.
        self.image_index.add_image(sig_id, signature)

        return signature

    def find_similar_images(self, signature, max_results=10):
        # Run the query.
        image_results = self.image_index.image_search(signature, max_results=max_results)
        image_results = {result['id']: result for result in image_results}

        # The search gave us back IDs.  Look these up to get the original paths.
        results = []
        for entry in self.get_from_ids(list(image_results.keys())):
            sig_id = entry['id']
            result = image_results[sig_id]
            results.append({
                'path': entry['path'],
                'score': result['score'],
                'unweighted_score': result['unweighted_score'],
                'id': sig_id,
            })

        # Re-sort the results by score.
        results.sort(key=lambda result: -result['score'])

        return results
            

