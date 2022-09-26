#include "VView.h"

// VVpython.exe is just a console build of VView.exe, and runs a regular Python terminal
// by default.
int main()
{
    return RunVView(true /* terminal */);
}
