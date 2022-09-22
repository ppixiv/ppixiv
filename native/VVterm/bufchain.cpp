/*
 * Generic routines to deal with send buffers: a linked list of
 * smallish blocks, with the operations
 *
 *  - add an arbitrary amount of data to the end of the list
 *  - remove the first N bytes from the list
 *  - return a (pointer,length) pair giving some initial data in
 *    the list, suitable for passing to a send or write system
 *    call
 *  - retrieve a larger amount of initial data from the list
 *  - return the current size of the buffer chain in bytes
 */

#include <algorithm>

#include "bufchain.h"
#include "misc.h"

struct bufchain::block
{
    string data;
    int pos = 0;
};

void bufchain::clear()
{
    chain.clear();
    buffersize = 0;
}

size_t bufchain::size() const
{
    return buffersize;
}

void bufchain::add(const void *data, size_t len)
{
    if(len == 0)
        return;

    const char *buf = (const char *)data;
    buffersize += len;

    auto newbuf = make_shared<block>();
    newbuf->data.assign(buf, len);
    newbuf->pos = 0;
    chain.push_back(newbuf);
}

void bufchain::consume(size_t len)
{
    assert(buffersize >= len);
    while (len > 0) {
        assert(!chain.empty());

        int remlen = len;
        shared_ptr<block> head = chain.front();
        int remaining_in_chunk = head->data.size() - head->pos;
        if (remlen >= remaining_in_chunk) {
            // consume the whole chunk and remove it
            remlen = remaining_in_chunk;
            chain.pop_front();
        }
        else
        {
            // consume part of the chunk
            head->pos += remlen;
        }
        buffersize -= remlen;
        len -= remlen;
    }
}

ptrlen bufchain::prefix()
{
    assert(!chain.empty());
    shared_ptr<block> head = chain.front();
    return ptrlen(head->data.data() + head->pos, head->data.size() - head->pos);
}
