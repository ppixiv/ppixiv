# A shell extension to add Explorer file associations for supported file types.

from win32com.shell import shell, shellcon
import win32gui, win32con

from . import open_path

# import pythoncom
TYMED_HGLOBAL = 1

class VviewShellExtension:
    _com_interfaces_ = [shell.IID_IShellExtInit, shell.IID_IContextMenu]
    _public_methods_ = shellcon.IContextMenu_Methods + shellcon.IShellExtInit_Methods

    def Initialize(self, folder, dataobj, hkey):
        self.dataobj = dataobj

    def QueryContextMenu(self, hMenu, indexMenu, idCmdFirst, idCmdLast, uFlags):
        if uFlags & shellcon.CMF_DEFAULTONLY:
            return 0

        sm = self.dataobj.GetData((win32con.CF_HDROP, None, 1, -1, TYMED_HGLOBAL))
        num_files = shell.DragQueryFile(sm.data_handle, -1)
        if num_files != 1:
            return 0

        self.filename = shell.DragQueryFile(sm.data_handle, 0)
        items = ['VVi&ew']

        command_index = 0
        win32gui.InsertMenu(hMenu, indexMenu, win32con.MF_STRING|win32con.MF_BYPOSITION, idCmdFirst + command_index, items[0])
        command_index += 1
        indexMenu += 1

        return command_index

    def InvokeCommand(self, ci):
        # mask, hwnd, verb, params, dir, nShow, hotkey, hicon = ci
        open_path.open_path(self.filename)

    def GetCommandString(self, cmd, typ):
        return '%i' % (cmd,)
