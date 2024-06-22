# This handles setting up file associations and Explorer menus.

import argparse, ctypes, os, sys, errno, ctypes, sys, tempfile, winreg
from pathlib import Path

_file_types = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.zip', '.webm', '.mp4', '.mkv']

use_open_in_explorer_scheme = True
use_file_associations = True
add_to_context_menu = True

# Get the path to VView.exe.
# XXX: This is stupid.
root_dir = Path(__file__).parent.parent.parent 
vview_exe = root_dir / 'bin' / 'VView.exe'

# This key is used for shell integration:
application_name = 'vview-shell'

def _signal_file_association_changes():
    """
    Let the shell know when we've added or removed file associations.
    """
    SHCNE_ASSOCCHANGED = 0x08000000
    
    SHCNF_IDLIST = 0x0000
    ctypes.windll.shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)

def register_vview_scheme():
    """
    Register the vview URL scheme.

    This handles "View in Explorer" in the UI.
    """
    key = _create_key_path(winreg.HKEY_CURRENT_USER, r'Software\Classes\vview')
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, 'vview')
    winreg.SetValueEx(key, 'URL Protocol', 0, winreg.REG_SZ, 'vview')
    winreg.SetValueEx(key, 'Content Type', 0, winreg.REG_SZ, 'application/vview')

    command_key = _create_key_path(key, r'shell\open\command')
    executable = f'{vview_exe} -m vview.shell.vview_scheme "%1"'
    winreg.SetValueEx(command_key, None, 0, winreg.REG_SZ, executable)

def register_file_associations():
    # Register a shell extension that launches vview.shell.open_path.  This is
    # done through VView.exe.
    key_command = _create_key_path(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{application_name}\shell\open\command')

    executable = f'{vview_exe} -m vview.shell.open_path "%1"'
    winreg.SetValueEx(key_command, None, 0, winreg.REG_SZ, executable)

    # Add it as an opener for each supported type.
    for file_type in _file_types:
        open_with_key = _create_key_path(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{file_type}\OpenWithProgids')
        winreg.SetValueEx(open_with_key, application_name, 0, winreg.REG_BINARY, b'')

def register_context_menu_items():
    # Register file types using AppliesTo on Classes\*, which  allows adding context menu
    # entries that are applied to the file extension.  This is a lot better than adding to
    # the file type, since that goes under the application associated with the file, which
    # causes problems (it'll be lost if the association is changed and it's hard to make it
    # always work).  This works for regular files, but for some reason we can't say
    # "System.ItemType:Directory" to use it for directories.
    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, fr"Software\Classes\*\shell\{application_name}")
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, "VV&iew")

    types = []
    for filetype in _file_types:
        types.append(f'System.FileName:*{filetype}')

    applies_to = ' OR '.join(types)
    winreg.SetValueEx(key, 'AppliesTo', 0, winreg.REG_SZ, applies_to)

    key = winreg.CreateKey(key, fr"command")
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, f'{vview_exe} -m vview.shell.open_path "%1"')

    # Add a Folder\shell item for directories.
    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, fr"Software\Classes\Folder\shell\{application_name}")
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, "VV&iew")

    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, fr"Software\Classes\Folder\shell\{application_name}\command")
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, f'{vview_exe} -m vview.shell.open_path "%1"')

def unregister():
    # Unregister vview-scheme:
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vview\shell\open\command')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vview\shell\open')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vview\shell')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vview')

    # Unregister file associations:
    _delete_registry_key(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{application_name}\shell\open\command')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{application_name}\shell\open')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{application_name}\shell')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{application_name}')

    for file_type in _file_types:
        _delete_registry_value(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{file_type}\OpenWithProgids', application_name)

    # Unregister context menu items:
    _delete_registry_key(winreg.HKEY_CLASSES_ROOT, fr'Software\Classes\Folder\shell\{application_name}\command')
    _delete_registry_key(winreg.HKEY_CLASSES_ROOT, fr'Software\Classes\Folder\shell\{application_name}')

    _signal_file_association_changes()

def register():
    if use_open_in_explorer_scheme:
        register_vview_scheme()

    if use_file_associations:
        register_file_associations()

    if add_to_context_menu:
        register_context_menu_items()

    _signal_file_association_changes()

def _create_key_path(key, path):
    for part in path.split('\\'):
        key = winreg.CreateKey(key, part)
    return key

def _delete_registry_key(key, path):
    try:
        winreg.DeleteKey(key, path)
    except WindowsError as e:
        if e.errno != errno.ENOENT:
            raise

def _delete_registry_value(key, path, value):
    try:
        subkey = winreg.OpenKey(key, path, access=winreg.KEY_WRITE)
        winreg.DeleteValue(subkey, value)
    except WindowsError as e:
        if e.errno != errno.ENOENT:
            raise

# XXX: call this from the main application, or installation
def write_vview_config():
    """
    Write a small configuration file that lets VView.exe know how to launch
    modules.
    """
    CSIDL_LOCAL_APPDATA = 0x001c
    result = ctypes.create_unicode_buffer(4096)

    if ctypes.oledll.shell32.SHGetFolderPathW(None, CSIDL_LOCAL_APPDATA, None, 0, result):
        print('Error retrieving local data directory')
        return

    local_data = Path(result.value)
    data_dir = local_data / 'VView'
    data_dir.mkdir(parents=True, exist_ok=True)
    config_path = data_dir / 'interpreter.txt'
    
    with config_path.open('w+t') as f:
        # sys.executable should point to python3.exe.  We want to store the DLL path, which
        # is next to it in the Python installation.
        dll_path = Path(sys.executable) / '..' / 'python3.dll'
        dll_path = dll_path.resolve()
        if not dll_path.exists():
            print(f'python3.dll doesn\'t exist (looked at: {dll_path}')
       
        interpreter_path = str(dll_path)
        f.write(f'{interpreter_path}\n')

def go():
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('--elevated', action='store_const', const=True)
        parser.add_argument('--unregister', '-u', action='store_const', const=True)
        args = parser.parse_args()

        if not vview_exe.exists():
            print('VView.exe doesn\'t exist: %s' % vview_exe)

        if args.unregister:
            unregister()
        else:
            register()
            write_vview_config()
    except:
        import traceback
        traceback.print_exc()


if __name__=='__main__':
    go()
