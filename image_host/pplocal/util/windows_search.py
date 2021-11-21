from pathlib import Path
from pprint import pprint

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

conn = None

def search(*, path=None, exact_path=None, substr=None, bookmarked=None, recurse=True):
    if adodbapi is None:
        return

    try:
        conn = adodbapi.connect('Provider=Search.CollatorDSO; Extended Properties="Application=Windows"')
    except Exception as e:
        print('Couldn\'t connect to search: %s' % str(e))
        return

    select = [
        'System.ItemPathDisplay',
        'System.ItemType',
        'System.Rating',
        'System.Image.HorizontalSize',
        'System.Image.VerticalSize',
        'System.Keywords',
        'System.ItemAuthors',
        'System.Title',
        'System.Comment',
        'System.MIMEType',
        'System.DateModified',
        'System.Kind',
    ]

    where = []
    if path is not None:
        # If we're recursing, limit the search with scope.  If not, filter on
        # the parent directory.
        if recurse:
            where.append("scope = '%s'" % escape_sql(str(path)))
        else:
            where.append("System.ItemFolderPathDisplay = '%s'" % escape_sql(str(path)))

    if exact_path is not None:
        where.append("System.ItemPathDisplay = '%s'" % escape_sql(str(exact_path)))

    # Add filters.
    # XXX: we're looking up files one at a time during glob which is too slow
    if substr is not None:
        for word in substr.split(' '):
            # Note that the double-escaping is required to make substring searches
            # work.  '"file*"' will prefix match "file*", but 'file*' won't.  This
            # seems to be efficient at prefix and suffix matches.
            where.append("""CONTAINS(System.FileName, '"*%s*"')""" % escape_sql(word))

    # We only use Windows search for images.  It'll return videos, but it doesn't give
    # us video dimensions, so we use our own index for that.
    # XXX: but it gives us other metadata that's a pain to get, piexif won't handle
    # mp4s
    # will need to figure out accessing those anyway
    # XXX: add videos
    where.append("(System.ItemType <> 'Directory' OR System.Kind = 'picture' OR System.Kind = 'video')")
    #where.append("System.Kind = 'picture'")

    # System.Rating is null for no rating, and 1, 25, 50, 75, 99 for 1, 2, 3, 4, 5
    # stars.  It's a bit weird, but we only use it for bookmarking.  Any image with 50 or
    # higher rating is considered bookmarked.
    if bookmarked:
        where.append("System.Rating >= 50")

    query = """
        SELECT %(select)s
        FROM SystemIndex 
        WHERE %(where)s
        ORDER BY System.FolderNameDisplay, System.FileName ASC
    """ % {
        'select': ', '.join(select),
        'where': ' AND '.join(where),
    }

    try:
        with conn:
            with conn.cursor() as cursor:
                cursor.execute(query)
                while True:
                    row = cursor.fetchone()
                    if row is None:
                        break

                    path = Path(row['System.ItemPathDisplay'])
                    result = {
                        'path': path,
                        'parent': path.parent,
                        'is_directory': row['System.ItemType'] == 'Directory',
                        'width': row['System.Image.HorizontalSize'],
                        'height': row['System.Image.VerticalSize'],

                        # Windows returns tags as an array and allows spaces in tags.  Nobody does
                        # that anymore: flatten it to a space-separated list and assume there are no
                        # spaces.
                        'tags': ' '.join(row['System.Keywords'] or ()),
                        'title': row['System.Title'] or '',
                        'comment': row['System.Comment'] or '',
                        'type': row['System.MIMEType'] or 'application/octet-stream',

                        # XXX: check timezone
                        'mtime': row['System.DateModified'].timestamp(),
                    }

                    rating = row['System.Rating']
                    result['bookmarked'] = rating is not None and rating >= 50

                    author = row['System.ItemAuthors']
                    if author is None:
                        result['author'] = ''
                    else:
                        result['author'] = ', '.join(author)

                    yield result

    except Exception as e:
        print('Windows search error:', e)

def test():
    import time
    s = time.time()
    for entry in search(path=Path('E:/images/auto')):
#    for entry in search(Path('e:/'), substr='a'):
        print('xxx', entry['path'])
    e = time.time()
    print(e-s)

if __name__ == '__main__':
    test()
