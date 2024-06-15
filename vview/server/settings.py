# Very trivial, lightweight access handling.  This isn't designed for use on a
# public server, only to have basic guest access and logins for local use.
# It stores login data in a text file to avoid the extra complexity of a database
# (this isn't multithreaded), and it doesn't use bcrypt since the extra dependancy
# isn't worth it.

import aiohttp, errno, hashlib, logging, json, os
from pathlib import Path, PurePosixPath
from ..util import misc
from pprint import pprint

log = logging.getLogger(__name__)

class Settings:
    def __init__(self, filename):
        self.filename = Path(filename)
        self.load()

    def load(self):
        self.data = self._read()

    def save(self):
        self._write(self.data)

    def _read(self):
        try:
            with open(self.filename, 'r') as f:
                data = f.read()
                return json.loads(data)
        except OSError as e:
            if e.errno != errno.ENOENT:
                raise
            return {}

    def _write(self, data):
        data = json.dumps(data, indent=4) + '\n'
        temp_path = Path(str(self.filename) + '.tmp')
        with open(temp_path, 'w+') as f:
            f.write(data)

        temp_path.replace(self.filename)

    def get_guest(self):
        """
        If guest access is enabled, return the guest user.  Otherwise, return None.
        """
        return self.get_user('guest')

    def get_local_user(self):
        """
        Return the admin user.

        This is always enabled, and is used for local access.  It isn't stored in the
        user list and can't be modified.
        """
        user = {
            'username': 'local_admin',
            'admin': True,
            'virtual': True,
        }
        return User(user, settings=self)

    def get_user(self, username):
        assert '|' not in username

        users = self.data.get('users', [])
        for user in users:
            if user.get('disabled'):
                continue
            if user.get('username') == username:
                return User(user, settings=self)
        return None

    # If token is valid, return the user, otherwise return None.
    #
    # If guest access is enabled and the token isn't valid, returns 'guest'.
    def check_token(self, token):
        if token.count('|') != 1:
            return self.get_user('guest')

        username = token.split('|')[0]
        user = self.get_user(username)

        if user is None:
            log.info(f'User {user} doesn\'t exist')
            return self.get_user('guest')

        if not user.check_token(token):
            log.info(f'Invalid token for user {user}')
            return self.get_user('guest')

        return user

    def get_folders(self):
        folders = []
        for folder in self.data.get('folders', []):
            name = folder.get('name')
            path = folder.get('path')

            path = Path(path)
            path = path.resolve()
            folders.append({
                'name': name,
                'path': path,
            })
        return folders
    
    def filesystem_path_to_folder(self, path):
        """
        If path is within a folder, return its path relative to the folder.  Otherwise,
        return path.
        """
        resolved_path = Path(path).resolve()
        for folder in self.get_folders():
            try:
                relative_path = resolved_path.relative_to(folder['path'])
            except ValueError:
                continue

            return PurePosixPath('/') / folder['name'] / relative_path

        return path

class User:
    def __init__(self, info, settings):
        self.info = info
        self.settings = settings

    @property
    def username(self):
        return self.info['username']

    def __str__(self):
        return self.info['username']

    @property
    def is_admin(self):
        return self.info.get('admin', False)

    @property
    def is_virtual(self):
        return self.info.get('virtual', False)

    def set_password(self, password):
        salt = os.urandom(32).hex()
        hashed_password = hashlib.sha1((password + salt).encode('utf-8')).hexdigest()
        encoded_hashed_password = salt + '|' + hashed_password
        self.info['password'] = encoded_hashed_password
        self.settings.save()

    def check_password(self, password):
        # If the user has no password, this is a guest account that doesn't require one.
        encoded_hashed_password = self.info.get('password')
        if encoded_hashed_password is None:
            return None

        salt, expected_hash = encoded_hashed_password.split('|')
        actual_hash = hashlib.sha1((password + salt).encode('utf-8')).hexdigest()
        return actual_hash == expected_hash

    def create_token(self):
        token = self.username + '|' + os.urandom(32).hex()
        tokens = self.info.setdefault('tokens', [])
        
        tokens.append(token)
        tokens = tokens[:-5]
        self.settings.save()
        return token

    def clear_tokens(self, *, except_for=None):
        """
        Clear the user's tokens, logging out any clients.

        If except_for is set, leave that token in the list.
        """
        tokens = self.info.get('tokens', [])
        if except_for in tokens:
            self.info['tokens'] = [except_for]
        else:
            self.info['tokens'] = []

        self.settings.save()

    def check_token(self, token):
        if token.count('|') != 1:
            return False

        return token in self.info.get('tokens', [])

    def check_auth(self, allow_guest=False):
        # If this user is admin, ignore these checks.
        if self.is_admin:
            return

        # If this command doesn't explicitly allow guest access, disallow the guest account.
        if not allow_guest and self.username == 'guest':
            raise misc.Error('access-denied', 'Not logged in')

    def check_image_access(self, entry, *, api=False):
        """
        If this user isn't allowed to access the given file entry, raise an exception.

        If api is true, raise an exception for returning an API error.  Otherwise, return
        a generic aiohttp error.
        """
        if self.is_admin:
            return

        if entry is None:
            entry = {}

        allowed_tags = self.tag_list
        if allowed_tags:
            if not entry.get('bookmarked'):
                log.info('Can\'t access image that isn\'t bookmarked')
                if api:
                    raise misc.Error('access-denied', 'Not allowed')
                else:
                    raise aiohttp.web.HTTPUnauthorized()

            bookmark_tags = entry.get('bookmark_tags', '').split(' ')
            for tag in allowed_tags:
                if tag in bookmark_tags:
                    log.debug(f"Access to {entry['path']} allowed through tag {tag}")
                    return
            
            log.info(f"Can't access image: bookmark tag list ({', '.join(bookmark_tags)}) doesn't include one of: {', '.join(allowed_tags)}")
            if api:
                raise misc.Error('access-denied', 'Not allowed')
            else:
                raise aiohttp.web.HTTPUnauthorized()

    @property
    def tag_list(self):
        """
        If this user is restricted to a set of bookmark tags, return a set of tags.
        Otherwise, return None (no restrictions).
        """
        if 'tags' in self.info:
            return set(self.info['tags'])
        else:
            return None

def test():
    auth = Settings('data/auth.json')
    user = auth.get_user('user')
    user.set_password('foo')
    assert user.check_password('foo')
    auth_token = user.create_token()
#    auth_token = 'x|y'
    user.clear_tokens(except_for=auth_token)
    pass

if __name__ == '__main__':
    test()
