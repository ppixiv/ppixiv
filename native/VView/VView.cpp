// This acts just like python.exe, by finding python3.dll and launching it.
// It does a couple other things:
// - Sets the CWD to the top of the installation, so running "VView -m module"
// works from anywhere.
// - If no arguments are given, runs the equivalent of "python -m vview.shell.default".
// This lets us act like a regular application if we're run directly.
//
// All arguments are passed along normally.  This means the multiprocessing module
// without having to use multiprocessing.set_executable, since it simply calls this
// instead of python.exe and everything works the same.
//
// Like pythonw.exe, we don't do anything to show exceptions to the user.  It's up
// to the application to do that.

#include "VView.h"

#include <windows.h>
#include <commctrl.h>
#include <windows.h>
#include <winreg.h>
#include <assert.h>

#include "Helpers.h"

#include "../shared/PythonHeader.h"

#include <io.h>
#include <fcntl.h>
#include <string>
#include <vector>
using namespace std;

namespace
{
    void ShowErrorDialog(wstring message)
    {
        MessageBoxW(NULL, message.c_str(), L"Error launching VView", MB_ICONHAND|MB_OK);
    }

    wstring GetModulePath()
    {
        WCHAR path[MAX_PATH] = L"";
        GetModuleFileNameW(NULL, path, MAX_PATH);
        return path;
    }

    wstring GetParent(wstring path)
    {
        size_t p0 = path.rfind(L'\\');
        if(p0 != wstring::npos)
            path.erase(p0);
        return path;
    }

    // We expect to be VView\bin\VView.exe.  Return VView\bin.
    wstring GetBinaryPath()
    {
        wstring path = GetModulePath();
        return GetParent(path); // VView\bin\VView.exe -> VView\bin
    }

    // We expect to be VView\bin\VView.exe.  Return VView, which is the
    // top of the installation.
    wstring GetTopPath()
    {
        wstring path = GetModulePath();
        path = GetParent(path); // VView\bin\VView.exe -> VView\bin
        path = GetParent(path); // VView\bin -> VView
        return path;
    }

    wstring GetLocalDataDir()
    {
        wstring path = Helpers::GetLocalAppData();
        if(path.empty())
            return L"";

        return path + L"\\VView";
    }

    // wcsdup() using Python's allocators.  Python already has _PyMem_RawWcsdup, but
    // they spitefully made it private for some reason.
    wchar_t *python_wcsdup(const wchar_t *s)
    {
        int size = wcslen(s);
        size *= sizeof(wchar_t);
        wchar_t *p = (wchar_t *) PyMem_RawMalloc(size + 1);
        if(p == nullptr)
            return nullptr;
        wcscpy(p, s);
        return p;
    }

    // A helper for releasing PyObject references.
    struct PyObj
    {
        PyObj(PyObject *obj)
        {
            o = obj;
        }
        static PyObj String(wstring s)
        {
            return PyUnicode_FromWideChar(s.data(), s.size());
        }

        // Return the PyObject, releasing it from this object so it won't be freed.
        PyObject *Release()
        {
            PyObject *result = o;
            o = nullptr;
            return result;
        }

        ~PyObj()
        {
            if(o)
                Py_DECREF(o);
        }

        PyObject *o = nullptr;
    };
}

extern "C" int RunVView(bool terminal)
{
    wstring binary_path = GetBinaryPath();
    wstring top_dir = GetTopPath();
    wstring python_path = binary_path + L"\\Python";

    // Even if we're running in windowed mode, we might have stdout, for example if
    // we're running in a virtual terminal environment like pterm.  Make sure it's
    // not buffered.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    // Set the CWD to the top of the installation.
    SetCurrentDirectory(top_dir.c_str());

    wstring local_data_dir = GetLocalDataDir();
    if(local_data_dir.empty())
    {
        ShowErrorDialog(L"Error getting AppData/Local");
        return 1;
    }

    // Do Python preconfiguration.
    {
        PyPreConfig preconfig;
        PyPreConfig_InitIsolatedConfig(&preconfig);
        preconfig.use_environment = false;
        preconfig.utf8_mode = true;
        Py_PreInitialize(&preconfig);
    }

    // Do Python configuration.
    {
        PyConfig config;
        PyConfig_InitIsolatedConfig(&config);
        config.user_site_directory = false;
        config.isolated = true;
        config.use_environment = false;
        config.quiet = true;
        config.buffered_stdio = false;
        config.site_import = true;

        PyConfig_SetString(&config, &config.program_name, L"VView8");
        PyConfig_SetString(&config, &config.home, python_path.c_str());
        PyConfig_SetString(&config, &config.stdio_encoding, L"utf-8");
        PyConfig_SetString(&config, &config.stdio_errors, L"surrogateescape");

        // We're in isolated mode, but we do want to parse the commandline.
        config.parse_argv = 1;

        // Set the Python path.
        PyWideStringList_Append(&config.module_search_paths, top_dir.c_str());
        PyWideStringList_Append(&config.module_search_paths, (python_path + L"\\python312.zip").c_str());
        PyWideStringList_Append(&config.module_search_paths, python_path.c_str());
        config.module_search_paths_set = 1;

        {
            // Put .pyc files inside our data directory, so we keep the installation
            // directory read-only.
            wstring pyc_path = local_data_dir + L"\\python";
            config.pycache_prefix = python_wcsdup(pyc_path.c_str());

            // Set the Python prefix to bin/Python, which is where our embedded Python
            // lives.  This tells Python where things like bin/Python/Lib/site-packages
            // are.
            config.prefix = python_wcsdup(python_path.c_str());
            config.exec_prefix = python_wcsdup(python_path.c_str());
        }

        vector<wstring> args;
        Helpers::GetCommandline(args);
        assert(args.size() >= 1); // always has the process name

        // If we're running the windowed version and not VViewTerm.exe, set a default module to
        // run if there are no arguments.  Don't do this for the console version, so VViewTerm.exe
        // runs the Python console by default.
        if(!terminal && args.size() == 1)
        {
            args.push_back(L"-m");
            args.push_back(L"vview.shell.default");
        }

        // Convert back to a WCHAR ** to pass arguments to PyConfig_SetArgv.
        vector<WCHAR *> PythonArgs;
        Helpers::ArrayToArgs(args, PythonArgs);
        PyStatus status = PyConfig_SetArgv(&config, PythonArgs.size()-1, PythonArgs.data());
        if (PyStatus_Exception(status)) {
            if(PyStatus_IsError(status))
                ShowErrorDialog(Helpers::UTF8ToWide(status.err_msg));

            if(PyStatus_IsExit(status))
                return status.exitcode;
        }

        status = Py_InitializeFromConfig(&config);
        if (PyStatus_Exception(status)) {
            if(PyStatus_IsError(status))
                ShowErrorDialog(Helpers::UTF8ToWide(status.err_msg));

            if(PyStatus_IsExit(status))
                return status.exitcode;
        }

        PyConfig_Clear(&config);
    }

    return Py_RunMain();
}
