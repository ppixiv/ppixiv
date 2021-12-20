import asyncio, sqlite3, threading, traceback, time
from contextlib import contextmanager

_transactions = {}

@contextmanager
def transaction(conn):
    """
    A transaction wrapper that uses savepoints to make each transaction independantly
    safe.

    with transaction(conn):
        conn.execute('command')

        with transaction(conn):
            conn.execute('command 2')

            fail()
        
    Command 2 is rolled back, and we're back to just after 'command'.  We can
    retry command 2, commit the transaction without it, or raise the exception
    to continue rolling back.
    """
    assert isinstance(conn, sqlite3.Connection), conn
    
    count = _transactions.get(conn)
    if count is None:
        count = 1
    _transactions[conn] = count + 1

    savepoint_name = 'sp%i' % count
    try:
        conn.execute('SAVEPOINT %s' % savepoint_name)
        yield
        conn.execute('RELEASE SAVEPOINT %s' % savepoint_name)
    except BaseException as e:
        # If we see something like GeneratorExit here, something went wrong.  Log
        # these, since it's extremely confusing if we silently roll back the transaction
        # like a normal exception, because these exceptions won't be logged otherwise.
        # GeneratorExit in particular can be raised if a generator stops being iterated,
        # and should return to commit the exception rather than just letting GeneratorExit
        # be raised.
        if isinstance(e, (Exception, KeyboardInterrupt, asyncio.CancelledError)):
            raise

        print('BaseException %s caused database rollback' % e.__class__)
        print(e)
        traceback.print_exc()

        # Still roll back the transaction.
        conn.execute('ROLLBACK TRANSACTION TO SAVEPOINT %s' % savepoint_name)
        conn.execute('RELEASE SAVEPOINT %s' % savepoint_name)
        raise
    except:
        # On exception, roll back the changes within the savepoint, then commit the
        # now empty savepoint to remove it.
        conn.execute('ROLLBACK TRANSACTION TO SAVEPOINT %s' % savepoint_name)
        conn.execute('RELEASE SAVEPOINT %s' % savepoint_name)
        raise
    finally:
        # Pop the transaction count back down so we reuse transaction counts.  If we
        # don't do this then every transaction will use a unique name, which could
        # thrash the SQL command cache.  If we're the last one, remove the connection
        # from the dictionary so we don't hold a reference to it.
        assert _transactions[conn] == count + 1
        if count == 1:
            del _transactions[conn]
        else:
            _transactions[conn] = count

class Database:
    """
    A base class for our databases.
    """
    def __init__(self, db_path, schema):
        self.db_path = db_path
        self.schema = schema

        self.connections = []
        self.lock = threading.Lock()

        # Open the DB now to create it.
        with self.connect() as conn:
            pass

    @contextmanager
    def connect(self, existing_connection=None, write=False):
        """
        Yield a pooled connection, committing it on completion or rolling back on exception.

        If write is true, the connection will be opened with BEGIN IMMEDIATE TRANSACTION
        active.

        """
        if existing_connection is not None:
            yield existing_connection
            return

        with self.lock:
            if self.connections:
                connection = self.connections.pop()
            else:
                connection = self.open_db()

        change_count = connection.total_changes
        if write:
            connection.execute('BEGIN IMMEDIATE TRANSACTION')
        else:
            connection.execute('BEGIN TRANSACTION')

        started_at = time.time()

        try:
            yield connection
            connection.commit()

            took = time.time() - started_at
            change_count = connection.total_changes

            # Log long-running transactions if we took a write lock.  This isn't ideal
            # since we should just check whether we actually had a write lock, but SQLite
            # doesn't seem to have any way to get that.  Also, we should only count time
            # since we actually took the write lock and not count time waiting for another
            # write lock, but again there seems to be no way to do that.  "Database is locked"
            # has always been the biggest problem people have with SQLite, and it's no wonder
            # why: it gives no tools whatsoever for troubleshooting it.
            if (write or change_count > 0) and took > 1:
                print('Database transaction took a long time (%.1f seconds)' % took)
                traceback.print_stack()

        finally:
            connection.rollback()

            with self.lock:
                assert not connection.in_transaction
                assert connection not in self.connections
                self.connections.append(connection)

    @contextmanager
    def cursor(self, conn=None):
        with self.connect(conn) as conn:
            assert isinstance(conn, sqlite3.Connection), conn

            with transaction(conn):
                cursor = conn.cursor()
                try:
                    yield cursor
                finally:
                    cursor.close()

    def open_db(self):
        # Connect to an in-memory database.  We don't use this, but you can't specify the schema
        # for the initial database, and we want to give a schema name to all of our databases.
        conn = sqlite3.connect(':memory:', check_same_thread=False, timeout=5)

        # Attach our database.
        self.attach(conn)
        conn.row_factory = sqlite3.Row

        # Use WAL.  This means commits won't be transactional across all of our databases,
        # but they don't need to be, and WAL is significantly faster.
        conn.execute(f'PRAGMA {self.schema}.journal_mode = WAL')

        # Why is this on by default?
        conn.execute(f'PRAGMA {self.schema}.secure_delete = 0;')

        # Why is this off by default?
        conn.execute(f'PRAGMA {self.schema}.foreign_keys = ON')

        # Enable read_uncommitted.  This means that searches will never be blocked by a write
        # lock during an update.  This can give inconsistent results if data is read during
        # a transaction, but that's harmless for our use case and it's much more important to
        # not stall a search.
        conn.execute(f'PRAGMA {self.schema}.read_uncommitted = ON;')

        return conn

    def attach(self, conn):
        conn.execute(f'ATTACH DATABASE "{self.db_path}" AS {self.schema}')

    # Helpers for both tables:
    def get_tables(self, conn):
        result = []
        for table in conn.execute(f'SELECT name FROM {self.schema}.sqlite_master WHERE type="table"'):
            result.append(table['name'])
        return result

    def _get_info(self, *, conn):
        """
        Return the one row from the info table.
        """
        with self.cursor(conn) as cursor:
            for result in cursor.execute(f'SELECT * FROM {self.schema}.info WHERE id = 1'):
                return result
            else:
                raise Exception('No info field in db: %s' % self)

    def _set_info(self, field, value, *, conn):
        with self.cursor(conn) as cursor:
            query = f'''
                UPDATE {self.schema}.info
                    SET %(field)s = ?
                    WHERE id = 1
            ''' % {
                'field': field
            }
            cursor.execute(query, [value])

    def get_db_version(self, *, conn=None):
        return self._get_info(conn=conn)['version']
    def set_db_version(self, version, *, conn=None):
        return self._set_info('version', version, conn=conn)

    @classmethod
    def escape_like(cls, s, escape='$'):
        """
        Escape s for use in a LIKE expression, using escape as the escape character.
        The result is used with a LIKE ? ESCAPE "?" expression.
        """
        s = s.replace(escape, escape + escape)
        s = s.replace('_', escape + '_')
        s = s.replace('%', escape + '_')
        return s
