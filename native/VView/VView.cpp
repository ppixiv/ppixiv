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
#include "LoadPython.h"

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

    // We expect to be VView\bin\VView.exe.  The parent of "bin" should be the
    // top of the installation.
    wstring GetTopDirectory()
    {
        WCHAR path[MAX_PATH] = L"";
        GetModuleFileNameW(NULL, path, MAX_PATH);

        // VView\bin\VView.exe
        //          ^
        WCHAR *p0 = wcsrchr(path, '\\');
        if(p0)
            *p0 = 0;

        // VView\bin\VView.exe
        //      ^
        p0 = wcsrchr(path, '\\');
        if(p0)
            *p0 = 0;

        return path;
    }

    wstring GetLocalDataDir()
    {
        wstring path = Helpers::GetLocalAppData();
        if(path.empty())
            return L"";

        return path + L"\\VView";
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
            return Python::PyUnicode_FromWideChar(s.data(), s.size());
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

#if 0
    // Add our site-packages directory as a package directory.
    // 
    // This is the same as:
    // 
    // import site
    // site.addsitepackages(set(), [top_dir + '/bin/site-packages'])
    bool AddSitePackagesDirectory(wstring top_dir, wstring &error)
    {
        PyObj path = PyObj::String(top_dir + L"/bin/python/Lib/site-packages");
        PyObj site_packages_path_array = Python::PyList_New(0);
        Python::PyList_Append(site_packages_path_array.o, path.o);

        PyObj known_paths = Python::PySet_New(nullptr);

        PyObj site = Python::PyImport_ImportModule("site");
        if(site.o == nullptr)
        {
            error = L"Could not import site module";
            return false;
        }

        PyObj addsitepackages = Python::PyObject_GetAttrString(site.o, "addsitepackages");
        if(addsitepackages.o == nullptr)
        {
            error = L"Couldn't import site.addsitepackages";
            return false;
        }

        PyObj runargs = Python::PyTuple_Pack(2, known_paths, site_packages_path_array);
        PyObj result = Python::PyObject_Call(addsitepackages.o, runargs.o, nullptr);
        return true;
    }
#endif
}

int RunVView(bool terminal)
{
    wstring top_dir = GetTopDirectory();

    // Even if we're running in windowed mode, we might have stdout, for example if
    // we're running in a virtual terminal environment like pterm.  Make sure it's
    // not buffered.
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    // Set the CWD to the top of the installation.
    SetCurrentDirectory(top_dir.c_str());

    wstring data_dir = GetLocalDataDir();
    if(data_dir.empty())
    {
        ShowErrorDialog(L"Error getting AppData/Local");
        return 1;
    }

    // Open our embedded Python DLL.
    wstring python_path;
    python_path = top_dir + L"\\bin\\python\\python310.dll";

    HMODULE python = LoadLibraryExW(python_path.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if(!python)
    {
        ShowErrorDialog(L"python3.dll couldn't be loaded: " + Helpers::GetError(GetLastError()));
        return 1;
    }

    // Load Python symbols.
    wstring PythonLoadError;
    if(!Python::Load(python, PythonLoadError))
    {
        ShowErrorDialog(PythonLoadError);
        return 1;
    }

    Python::Py_SetProgramName(L"VView");
    Python::Py_SetPythonHome((top_dir + L"/").c_str());
    Python::Py_SetStandardStreamEncoding("utf-8", "utf-8");
    
    // Do Python preconfiguration.
    {
        PyPreConfig preconfig;
        Python::PyPreConfig_InitIsolatedConfig(&preconfig);
        preconfig.use_environment = false;
        preconfig.utf8_mode = true;
        Python::Py_PreInitialize(&preconfig);
    }

    // Do Python configuration.
    {
        PyConfig config;
        Python::PyConfig_InitIsolatedConfig(&config);
        config.user_site_directory = false;
        config.isolated = true;
        config.use_environment = false;
        config.quiet = true;
        config.buffered_stdio = false;
        config.site_import = true;

        // We're in isolated mode, but we do want to parse the commandline.
        config.parse_argv = 1;

        // Put .pyc files inside our data directory, so we keep the installation
        // directory read-only.
        {
            wstring pyc_path = data_dir + L"\\python";
            config.pycache_prefix = Python::python_wcsdup(pyc_path.c_str());

            // Set the Python prefix to bin/Python, which is where our embedded Python
            // lives.  This tells Python where things like bin/Python/Lib/site-packages
            // are.
            wstring prefix = top_dir + L"\\bin\\Python";
            config.prefix = Python::python_wcsdup(prefix.c_str());
            config.exec_prefix = Python::python_wcsdup(prefix.c_str());
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
        PyStatus status = Python::PyConfig_SetArgv(&config, PythonArgs.size()-1, PythonArgs.data());
        if (Python::PyStatus_Exception(status)) {
            if(Python::PyStatus_IsError(status))
                ShowErrorDialog(Helpers::UTF8ToWide(status.err_msg));

            if(Python::PyStatus_IsExit(status))
                return status.exitcode;
        }

        // Set the Python path.
        wstring path =
            top_dir + L";" +
            top_dir + L"\\bin\\python\\python310.zip;" +
            top_dir + L"\\bin\\python";
        Python::Py_SetPath(path.c_str());

        status = Python::Py_InitializeFromConfig(&config);
        if (Python::PyStatus_Exception(status)) {
            if(Python::PyStatus_IsError(status))
                ShowErrorDialog(Helpers::UTF8ToWide(status.err_msg));

            if(Python::PyStatus_IsExit(status))
                return status.exitcode;
        }

        Python::PyConfig_Clear(&config);
    }

//    wstring error;
//    if(!AddSitePackagesDirectory(top_dir, error))
//        ShowErrorDialog(error);

    Python::Py_RunMain();

    return 0;
}
