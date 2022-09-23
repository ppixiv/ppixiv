#include "../VVterm/vvterm.h"

#include <windows.h>

// A test stub for VVterm.dll.
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmdline, int show)
{
    VVterm_Create();
    VVterm_SetVisible(true);

    HANDLE events, display;
    VVterm_GetHandles(&events, &display);

    WriteFile(display, "test\n", 3, NULL, NULL);

//    char buf[1024];
//    int x = ReadFile(input, buf, 4, NULL, NULL);

    while(true)
    {
        WaitForSingleObject(events, INFINITE);
        VVTermEvent event = VVTerm_GetNextEvent();
        if(event == VVTermEvent_Shutdown)
            break;

        switch(event)
        {
        case VVTermEvent_Close:
            VVterm_Shutdown();
            break;
        case VVTermEvent_Minimized:
            VVterm_SetVisible(false);
            break;
        }
    }

    return 0;
}
