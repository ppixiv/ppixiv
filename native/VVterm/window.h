#ifndef window_h
#define window_h

#include <memory>
using namespace std;

// A command sent to the window from the client, over the ClientPipes control pipe.
struct VVtermMessage
{
    enum Command
    {
        Command_Shutdown,
        Command_SetVisible,
    };

    VVtermMessage(Command command_, intptr_t param1_=0):
        command(command_), param1(param1_) { }

    Command command;
    intptr_t param1 = 0;
};

class ClientPipes;
void RunTerminalWindow(shared_ptr<ClientPipes> client_pipes, HICON icon);

#endif
