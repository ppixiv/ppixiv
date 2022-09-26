#ifndef LoadPython_h
#define LoadPython_h

#include <string>
#include <windows.h>

// Python.h tries to link to "python310_d.lib" by default, and that doesn't even
// exist in the distribution.  Turn that off so we can link the correct library
// ourself.
#define Py_NO_ENABLE_SHARED
#include <Python.h>

#undef Py_DECREF

namespace Python
{
    bool Load(HMODULE dll, std::wstring &error);

    // We can declare a pointer to a function with the same signature as func() with:
    // decltype(func) func_ptr;
    // 
    // This is a handy way of declaring pointers to existing function declarations,
    // without having to duplicate the signatures.
#define PYTHON_FUNCS \
    FUNC(PyMem_RawMalloc) \
    FUNC(PyMem_RawCalloc) \
    FUNC(PyMem_RawRealloc) \
    FUNC(PyMem_RawFree) \
    FUNC(Py_Main) \
    FUNC(Py_RunMain) \
    FUNC(Py_Initialize) \
    FUNC(Py_SetPythonHome) \
    FUNC(Py_SetStandardStreamEncoding) \
    FUNC(Py_SetProgramName) \
    FUNC(Py_SetPath) \
    FUNC(PyRun_AnyFileEx) \
    FUNC(PyRun_SimpleStringFlags) \
    FUNC(PyPreConfig_InitPythonConfig) \
    FUNC(PyPreConfig_InitIsolatedConfig) \
    FUNC(Py_PreInitialize) \
    FUNC(PyConfig_InitPythonConfig) \
    FUNC(PyConfig_InitIsolatedConfig) \
    FUNC(PyConfig_Clear) \
    FUNC(Py_InitializeFromConfig) \
    FUNC(PyConfig_SetArgv) \
    FUNC(PyStatus_Exception) \
    FUNC(PyStatus_IsError) \
    FUNC(PyStatus_IsExit) \
    FUNC(PyImport_ImportModule) \
    FUNC(PyObject_GetAttrString) \
    FUNC(PyTuple_Pack) \
    FUNC(PyObject_Call) \
    FUNC(PyUnicode_FromWideChar) \
    FUNC(PySet_New) \
    FUNC(PyList_New) \
    FUNC(PyList_Append) \
    FUNC(_Py_DecRef)

    // Declare pointers to each Python function that we use.
#define FUNC(name) extern decltype(name) *name;
    PYTHON_FUNCS
#undef FUNC

    // wcsdup() using Python's allocators.  Python already has _PyMem_RawWcsdup, but
    // they spitefully made it private for some reason.
    wchar_t *python_wcsdup(const wchar_t *s);
}

// Redefine stuff that python.h implements as macros, so it points to our imported
// version.
#undef Py_DECREF
#define Py_DECREF Python::_Py_DecRef

#endif LoadPython_h


