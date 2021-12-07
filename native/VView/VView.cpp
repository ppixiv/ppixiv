// This is a tiny stub that just finds the Python interpreter and launches
// the application.  It's only needed for things like file associations, which
// don't like to work with anything but executables.

#include <windows.h>

#include <string>
using namespace std;

#include "resource.h"
#include "Helpers.h"

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    // Pass any arguments we received to the application.
    RunApplication(lpCmdLine);
    return 0;
}
