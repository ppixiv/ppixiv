#include "../VVterm/vvterm.h"

#include <windows.h>

// A test stub for VVterm.dll.
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmdline, int show)
{
    VVterm_Create();
    VVterm_SetVisible(true);
    bool b = VVterm_GetVisible();

    HANDLE events, input, output;
    VVterm_GetHandles(&events, &input, &output);

    // if we don't shut these down, Backend_PTY::shutdown gets stuck waiting
    // on handle_input_threadfunc
    /*CloseHandle(events);
    CloseHandle(input);
    CloseHandle(output);*/

    VVterm_Shutdown();
    WriteFile(output, "foo", 3, NULL, NULL);


    return 0;
    while(true)
    {
        WaitForSingleObject(events, INFINITE);
        VVTermEvent event = VVTerm_GetNextEvent();
        if(event == VVTermEvent_Shutdown)
            break;

        switch(event)
        {
        case VVTermEvent_Close:
            VVterm_SetVisible(false);
            Sleep(500);
            VVterm_SetVisible(true);
//            VVterm_Shutdown();
            break;
        case VVTermEvent_Minimized:
            VVterm_Shutdown();
            break;
        }
//        Sleep(500);
    }

    CloseHandle(events);
    CloseHandle(input);
    CloseHandle(output);

//    WriteFile(output, "foo", 3, NULL, NULL);

    char buf[1024];
//    int x = ReadFile(input, buf, 4, NULL, NULL);
//    while(1)
//        Sleep(100);
    Sleep(10000);
    VVterm_Shutdown();

    return 0;
}
