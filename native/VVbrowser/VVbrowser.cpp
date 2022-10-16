#include "../shared/PythonHeader.h"
#include "resource.h"
#include "VVbrowserWindow.h"

#include <windows.h>

using namespace std;

HINSTANCE DLLInstance;

BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID reserved)
{
    switch(reason) 
    { 
    case DLL_PROCESS_ATTACH:
        // Store the HINSTANCE to our DLL.
        DLLInstance = hinst;
        break;
    }

    return TRUE;
}

namespace
{
    wstring PyStringToString(PyObject *s)
    {
        if(s == nullptr)
            return wstring();

        Py_ssize_t length = 0;
        wchar_t *buffer = PyUnicode_AsWideCharString(s, &length);
        wstring result(buffer, length);
        PyMem_Free(buffer);
        return result;
    }
}

static PyObject *VVbrowser_open(PyObject *self, PyObject *args, PyObject *kwargs)
{
    // Parse args.
    static const char *kwlist[] = {
        "url",
        "profile",
        "fullscreen",
        "maximized",
        "fitImageSize",
        nullptr
    };

    VVbrowserWindow::Config config;

    PyObject *urlObj = nullptr, *profileObj = nullptr, *downloadDirObj = nullptr;
    if(!PyArg_ParseTupleAndKeywords(args, kwargs, "|$UUbb(ii)", (char **) kwlist, 
        &urlObj,
        &profileObj,
        &config.fullscreen,
        &config.maximized,
        &config.fitWidth,
        &config.fitHeight
    ))
        return NULL;

    if(urlObj == nullptr)
    {
        PyErr_SetString(PyExc_RuntimeError, "A URL must be specified");
        return nullptr;
    }

    // After checking arguments, see if the runtime is installed.  The caller should check
    // this first.
    if(VVbrowserWindow::WebViewInstallationRequired())
        PyErr_SetString(PyExc_RuntimeError, "The WebView2 runtime must be installed");

    config.url = PyStringToString(urlObj);
    config.profilePath = PyStringToString(profileObj);

    // Load the icon from this DLL.  We do this here since AppWindow doesn't know
    // about the DLL it's in.
    config.defaultIcon = LoadIcon(DLLInstance, MAKEINTRESOURCE(IDI_WINDOW_ICON));

    Py_BEGIN_ALLOW_THREADS
    VVbrowserWindow::OpenBrowserWindow(config);
    Py_END_ALLOW_THREADS

    return PyLong_FromLong(1);
}

static PyObject *VVbrowser_installationRequired(PyObject *self, PyObject *args)
{
    bool result = VVbrowserWindow::WebViewInstallationRequired();
    return result? Py_True:Py_False;
}

static PyMethodDef VVbrowserMethods[] = {
    {"open",  (PyCFunction) VVbrowser_open, METH_VARARGS|METH_KEYWORDS, "Open a VVbrowser window."},
    {"installationRequired",  VVbrowser_installationRequired, METH_VARARGS,
     "Return true if installation of the WebView2 runtime is required."},
    {nullptr, nullptr, 0, nullptr},
};

static struct PyModuleDef VVbrowserModule =
{
    PyModuleDef_HEAD_INIT,
    "VVbrowser",   // name
    nullptr,    // docstring
    -1,
    VVbrowserMethods,
};

PyMODINIT_FUNC PyInit_VVbrowser()
{
    return PyModule_Create(&VVbrowserModule);
}
