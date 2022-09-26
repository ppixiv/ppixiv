#include "LoadPython.h"
#include "Helpers.h"

#include <windows.h>

#include <exception>
#include <string>
#include <vector>
using namespace std;

class LoadError: public exception { };

// Define Python::Funcs.
#define FUNC(name) decltype(name) *Python::name;
PYTHON_FUNCS
#undef FUNC

template<typename T>
void GetFunc(HMODULE python, T *&func, const char *name)
{
    func = (T *) GetProcAddress(python, name);
}

// Load the Python functions that we use.
bool Python::Load(HMODULE dll, wstring &error)
{
    // Make an array of functions we're looking up, so we don't need to use this #define
    // ugliness in our actual load loop.
    vector<pair<const char *, void **>> func_to_name;
#define FUNC(name) func_to_name.push_back(make_pair(#name, (void **) &Python::name));
    PYTHON_FUNCS
#undef FUNC

    // Load each function.
    for(auto it: func_to_name)
    {
        const char *name = it.first;
        void **func = it.second;
        *func = GetProcAddress(dll, name);
        if(*func == nullptr)
        {
            wstring result = Helpers::GetError(GetLastError());
            error = wstring(L"Couldn't find symbol ") + Helpers::UTF8ToWide(name) + L":\n\n" + result;
            return false;
        }
    }

    return true;
}

wchar_t *Python::python_wcsdup(const wchar_t *s)
{
    int size = wcslen(s);
    size *= sizeof(wchar_t);
    wchar_t *p = (wchar_t *) Python::PyMem_RawMalloc(size + 1);
    if(p == nullptr)
        return nullptr;
    wcscpy(p, s);
    return p;
}

static inline void _Py_DECREF(PyObject *op)
{
    // Stable ABI for Python 3.10 built in debug mode.
    _Py_DecRef(op);
}
