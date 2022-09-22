#ifndef bufchain_h
#define bufchain_h

#include <list>
#include <memory>
using namespace std;

#include "misc.h"

class bufchain {
public:
    void clear();
    size_t size() const;
    void add(const void *data, size_t len);
    ptrlen prefix();
    void consume(size_t len);

private:
    struct block;

    list<shared_ptr<block>> chain;
    size_t buffersize = 0;           // current amount of buffered data
};

#endif
