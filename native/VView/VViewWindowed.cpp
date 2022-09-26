#include "VView.h"

#include <windows.h>

// This is the windowed front-end for VViewShared, aka VView.exe.
int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    return RunVView(false /* windowed */);
}
