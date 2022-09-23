#ifndef Client_H
#define Client_H

#include <string>
#include <memory>
#include <windows.h>

// This is the interface the client receives to communicate with its owner.
class ClientInterface
{
public:
    // A packet from send_control was received:
    virtual void control(const void *data, int len) = 0;
    virtual void output(const void *data, int len) = 0;

    // The user closed stdout, so the window should exit.
    virtual void display_closed() = 0;
};

// This holds two bidirectional pipes: a display connection for sending display
// input and output, and a control connection for sending VVtermMessages and VVTermEvents.
class ClientPipes
{
public:
    static shared_ptr<ClientPipes> create();

    // Return the client-side connection for each pipe.  The server connection is
    // internal to Client.
    virtual shared_ptr<HandleHolder> GetDisplayConnection() = 0;
    virtual shared_ptr<HandleHolder> GetControlConnection() = 0;
};

class Client
{
public:
    static shared_ptr<Client> create(std::shared_ptr<ClientPipes> pipes, ClientInterface *callbacks);

    virtual ~Client() { }
    virtual void shutdown() = 0;
    virtual void send(const char *buf, int len) = 0;
    virtual void send_control(string message) = 0;
    virtual void size(int width, int height) = 0;
};

#endif
