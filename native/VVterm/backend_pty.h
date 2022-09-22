#ifndef Backend_PTY_H
#define Backend_PTY_H

#include "Backend.h"

#include <memory>
using namespace std;

class BackendInterface;
struct TermConfig;
shared_ptr<Backend> Create_Backend_PTY(BackendInterface *callbacks, shared_ptr<const TermConfig> conf);

#endif
