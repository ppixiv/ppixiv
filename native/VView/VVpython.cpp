#include "VView.h"

// This is the console front-end for VViewShared, which is our actual Python
// environment.
int main()
{
    return RunVView(true /* terminal */);
}
