# This handles setting up file associations and Explorer menus.

import argparse, ctypes, os, re, sys, tempfile, errno, ctypes, sys, tempfile, winreg
from pathlib import Path
import win32con, win32process, win32event, pywintypes
from win32com.shell.shell import ShellExecuteEx
from win32com.shell import shellcon
from win32.lib import winerror

# The path to VView.exe.
# XXX: This is stupid.
top_dir = Path(__file__).parent.parent.parent # /image_host
root_dir = top_dir.parent # /
vview_exe = root_dir / "VView.exe"

application_name = 'VView'


# Attempt to 're-execute' our current process with elevation.
def RunElevated():
    if ctypes.windll.shell32.IsUserAnAdmin():
        return

    # Redirect output so we give the user some clue what went wrong.  This
    # also means we need to use COMSPEC.
    tempbase = tempfile.mktemp('vviewregistration')
    outfile = Path(tempbase + '.out')
    batfile = Path(tempbase + '.bat')

    try:
        args = ['-m', 'pplocal.shell.register', '--elevated'] + sys.argv[1:]
        params = ' '.join(f'"{a}"' for a in args)
        data = f"""
"{vview_exe}" {params} > "{outfile}"
"""
        with batfile.open("w+") as batf:
            batf.write(data)

        executable = os.environ.get("COMSPEC", "cmd.exe")
        try:
            result = ShellExecuteEx(
                fMask=shellcon.SEE_MASK_NOCLOSEPROCESS,
                lpVerb="runas",
                lpFile=executable,
                lpParameters=f'/Q /C "{batfile}"',
                nShow=win32con.SW_HIDE,
            )
        except pywintypes.error as e:
            if e.winerror == winerror.ERROR_CANCELLED:
                print('Installation was cancelled.')
                return

            print('Elevation error: %s' % e)
            return

        hproc = result["hProcess"]
        win32event.WaitForSingleObject(hproc, win32event.INFINITE)
        exit_code = win32process.GetExitCodeProcess(hproc)
        with outfile.open() as outf:
            output = outf.read()

        if exit_code:
            print("Error: registration failed (exit code %s)." % exit_code)
        print(output, end=" ")
    finally:
        outfile.unlink(missing_ok=True)
        batfile.unlink(missing_ok=True)











def register_view_in_explorer():
    """
    REgister the vviewinexplorer scheme.

    This handles "View in Explorer" in the UI.
    """
    args = [str(vview_exe), '-m', 'pplocal.shell.view_in_explorer', '"%1"']

    key = _create_key_path(r'Software\Classes\vviewinexplorer', winreg.HKEY_CURRENT_USER)
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, 'vviewinexplorer')
    winreg.SetValueEx(key, 'URL Protocol', 0, winreg.REG_SZ, 'vviewinexplorer')
    winreg.SetValueEx(key, 'Content Type', 0, winreg.REG_SZ, 'application/view-in-explorer')

    key = _create_key_path(r'Software\Classes\vviewinexplorer\shell\open\command', winreg.HKEY_CURRENT_USER)
    winreg.SetValueEx(key, None, 0, winreg.REG_SZ, ' '.join(args))

def unregister_view_in_explorer():
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vviewinexplorer\shell\open\command')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vviewinexplorer\shell\open')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vviewinexplorer\shell')
    _delete_registry_key(winreg.HKEY_CURRENT_USER, r'Software\Classes\vviewinexplorer')

def _signal_file_association_changes():
    """
    Let the shell know when we've added or removed file associations.
    """
    # This doesn't actually seem to work.  How do we tell the system to unload and reload
    # the COM service when it changes?
    SHCNE_ASSOCCHANGED = 0x08000000
    SHCNF_FLUSH        = 0x1000
    
    SHCNF_IDLIST = 0x0000
    ctypes.windll.shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)

_file_types = ['.png', '.jpg', '.jpeg', '.gif', '.zip', '.webm', '.mp4', '.mkv']

def register_file_associations():
    # Register a shell extension that launches pplocal.shell.open_path.  This is
    # done through VView.exe.
    key_command = _create_key_path(application_name + r'\shell\open\command', winreg.HKEY_CLASSES_ROOT)

    executable = f'{vview_exe} -m pplocal.shell.open_path "%1"'
    winreg.SetValueEx(key_command, None, 0, winreg.REG_SZ, executable)

    # Add it as an opener for each supported type.
    for file_type in _file_types:
        open_with_key = _create_key_path(rf'{file_type}\OpenWithProgids', winreg.HKEY_CLASSES_ROOT)
        winreg.SetValueEx(open_with_key, application_name, 0, winreg.REG_BINARY, b'')

    _signal_file_association_changes()

def unregister_file_associations():
    _delete_registry_key(winreg.HKEY_CLASSES_ROOT, application_name + r'\shell\open\command')

    for file_type in _file_types:
        _delete_registry_value(winreg.HKEY_CLASSES_ROOT, rf'{file_type}\OpenWithProgids', application_name)

_shell_extension_uuid = '{DED0336C-C9EE-4a7f-8D7F-C660393C381F}'
def register_shell_extension():
    from win32com.server import register
    import pythoncom
    print(pythoncom.frozen)

    verProgID = None
    defIcon = None # _get(cls, "_reg_icon_")

    spec = 'pplocal.shell.shell_extension.VviewShellExtension'

    print(top_dir)
    
    addnPath = str(top_dir)

    register.RegisterServer(
        _shell_extension_uuid, # clsid
        spec,
        'VView file extension handler', # desc
        'VView.ContextMenu', # progID
        verProgID,
        defIcon,
        'both', # threadingModel
        None, # policySpec
        [], # catids
        { "Debugging": "0" },
        True, # addPyComCat
        None, # dispatcherSpec
        None, # clsctx
        addnPath,
    )

    # Register the file types that use the COM extension.  This is only used for
    # directories.
    handler_key = winreg.CreateKey(winreg.HKEY_CLASSES_ROOT, fr"Folder\shellex\ContextMenuHandlers\{application_name}")
    winreg.SetValueEx(handler_key, None, 0, winreg.REG_SZ, _shell_extension_uuid)

def unregister_shell_extension():
    from win32com.server import register
    register.UnregisterServer(_shell_extension_uuid, 'VView.ContextMenu', None, None)

    _delete_registry_key(winreg.HKEY_CLASSES_ROOT, fr'Folder\shellex\ContextMenuHandlers\{application_name}')

def register():
    register_view_in_explorer()
    register_file_associations()
    register_shell_extension()

    _signal_file_association_changes()

def unregister():
    unregister_view_in_explorer()
    unregister_file_associations()
    unregister_shell_extension()

    _signal_file_association_changes()

def _create_key_path(path, top):
    for part in path.split('\\'):
        new_top = winreg.CreateKey(top, part)
        top = new_top
    return top


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
    data_dir = local_data / 'PViewer'
    config_path = data_dir / 'interpreter.txt'
    print(config_path)
    
    with config_path.open('w+t') as f:
        interpreter_path = sys.executable
        root_path = os.getcwd()
        f.write(f'"{interpreter_path}"\n')
        f.write(f'{root_path}\n')

def go():
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('--elevated', action='store_const', const=True)
        parser.add_argument('--unregister', '-u', action='store_const', const=True)
        args = parser.parse_args()

        if not vview_exe.exists():
            print('VView.exe doesn\'t exist: %s' % vview_exe)

        # All of these need elevation.
        #
        # The --elevated flag is an extra sanity check to make sure this doesn't loop.
        if not args.elevated and not ctypes.windll.shell32.IsUserAnAdmin():
            RunElevated()
            return

        if args.unregister:
            unregister()
        else:
            register()
    except:
        import traceback
        traceback.print_exc()


if __name__=='__main__':
    go()
