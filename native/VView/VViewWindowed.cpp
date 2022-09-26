#include "VView.h"

#include <windows.h>

// Windowed front-end to VView.
int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow)
{
    return RunVView(false /* windowed */);
}
