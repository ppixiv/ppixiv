// This is a tiny stub that just finds the Python interpreter and launches
// the application.  It's only needed for things like file associations, which
// don't like to work with anything but executables.

#include <windows.h>

#include <io.h>
#include <fcntl.h>
#include <string>
using namespace std;

#include "resource.h"
#include "Helpers.h"

wstring GetError(DWORD error);


int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    wstring arguments(lpCmdLine);

    // If no arguments were provided, run the server.
    bool running_default = false;
    if(arguments.empty())
    {
        arguments = L"-u -m vview.server";
        running_default = true;
    }

    // Pass any arguments we received to the application.
    wstring error;
    if(RunApplication(arguments, error, false))
        return 0;

    MessageBoxW(NULL, error.c_str(), L"Error launching VView", MB_OK);

    return 0;
}
