#ifndef PythonHeader_H
#define PythonHeader_H

// Python's headers are obnoxious: they try to link the Python library, but when
// we're in a debug build, it tries to link to "python310_d.lib".  That doesn't
// exist in the distribution, and there's no flag to say "leave my imports alone".
// 
// We can't undefine _DEBUG, since it'll break linking with other source files.
// 
// If we define Py_NO_ENABLE_SHARED, it won't import the library, but then it won't
// declare symbols as imports either (it treats it as a static link).
// 
// The workaround is confusing: we have to define both Py_ENABLE_SHARED and
// Py_NO_ENABLE_SHARED.  Py_NO_ENABLE_SHARED just prevents the link (it prevents
// MS_COREDLL from being defined), and Py_ENABLE_SHARED enables shared imports.
// 
// This is a mess.  Don't use #pragma linking in library headers without a clear
// way to turn it off.

#define Py_ENABLE_SHARED
#define Py_NO_ENABLE_SHARED
#include "Python.h"

// The library we actually want:
#pragma comment(lib, "python312.lib")

#endif

