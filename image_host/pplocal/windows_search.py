from pathlib import Path

# Get this from pywin32, not from adodbapi:
try:
    import adodbapi
except ImportError:
    adodbapi = None
    print('Windows search not available')

# adodbapi seems to have no way to escape strings, and Search.CollatorDSO doesn't seem
# to support parameters at all.
def escape_sql(s):
    result = ''
    for c in s:
        if c == '\'':
            result += "'"
        result += c
    return result

def search(top, substr, include_dirs=True, include_files=True):
    top = str(top)
    if adodbapi is None:
        return

    try:
        conn = adodbapi.connect('Provider=Search.CollatorDSO; Extended Properties="Application=Windows"')
    except Exception as e:
        print('Couldn\'t connect to search: %s' % str(e))
        return

    try:    
        where = []
        where.append("scope = '%s'" % escape_sql(top))
        where.append("CONTAINS(System.FileName, '%s')" % escape_sql(substr))

        if not include_dirs:
            where.append("System.Kind <> 'Folder'")
        if not include_files:
            where.append("System.Kind = 'Folder'")
        query = """
            SELECT System.ItemPathDisplay, System.Kind
            FROM SystemIndex 
            WHERE %(where)s
            ORDER BY System.ItemPathDisplay
        """ % {
            'where': ' AND '.join(where),
        }

        cursor = conn.cursor()
        cursor.execute(query)
        try:
            while True:
                row = cursor.fetchone()
                if row is None:
                    break

                path, file_type = row
                yield path, file_type == ('folder',)
        finally:
            cursor.close()
    finally:
        conn.close()

def test():
    for path, is_dir in search(Path('e:/'), 'a', include_files=False):
        print(path, is_dir)

if __name__ == '__main__':
    test()
