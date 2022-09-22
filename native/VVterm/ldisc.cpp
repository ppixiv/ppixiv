#if 0
/*
 * ldisc.c: PuTTY line discipline. Sits between the input coming
 * from keypresses in the window, and the output channel leading to
 * the back end. Implements echo and/or local line editing,
 * depending on what's currently configured.
 */

#include <stdio.h>
#include <ctype.h>
#include <assert.h>

#include "backend.h"
#include "internal.h"
#include "terminal.h"

class Ldisc
{
public:
    Ldisc(Terminal *term, Backend *backend, BackendInterface *seat);
    ~Ldisc();
    void send(const void *vbuf, int len, bool interactive);

private:
    void send_to_backend_raw(const void *vbuf, size_t len);
    void bsb(int n);
    bool char_start(unsigned char c);
    void c_write(const void *buf, int len);
    void pwrite(unsigned char c);

    Terminal *term;
    Backend *backend;
    BackendInterface *seat;

    string input_buf;
    bool quotenext;
};

#define ECHOING (backend_ldisc_option_state(ldisc->backend, LD_ECHO))
#define EDITING (backend_ldisc_option_state(ldisc->backend, LD_EDIT))

void Ldisc::c_write(const void *buf, int len)
{
    seat->output(buf, len);
}

static int plen(unsigned char c)
{
    if (c >= 32 && c <= 126)
        return 1;
    else if (c < 128)
        return 2;                      // ^x for some x
    else if (c >= 0xC0)
        return 1;                      // UTF-8 introducer character (FIXME: combining / wide chars)
    else if (c >= 0x80 && c < 0xC0)
        return 0;                      // UTF-8 followup character
    else
        return 4;                      // <XY> hex representation
}

void Ldisc::pwrite(unsigned char c)
{
    if ((c >= 32 && c <= 126) || c >= 0x80) {
        c_write(&c, 1);
    } else if (c < 128) {
        char cc[2];
        cc[1] = (c == 127 ? '?' : c + 0x40);
        cc[0] = '^';
        c_write(cc, 2);
    } else {
        char cc[5];
        sprintf(cc, "<%02X>", c);
        c_write(cc, 4);
    }
}

// Return true if c is the start of a character.  This is false for UTF-8
// continuation bytes.
bool Ldisc::char_start(unsigned char c)
{
    return c < 0x80 || c >= 0xC0;
}

// Write "\H \H", to backspace, erase a character and then backspace again.
void Ldisc::bsb(int n)
{
    while (n--)
        c_write("\010 \010", 3);
}

#define CTRL(x) (x^'@')
#define KCTRL(x) ((x^'@') | 0x100)

Ldisc::Ldisc(Terminal *term_, Backend *backend_, BackendInterface *seat_)
{
    input_buf;
    quotenext = false;
    backend = backend_;
    term = term_;
    seat = seat_;

    /* Link ourselves into the backend and the terminal */
    if (term)
        term->ldisc = this;
    if (backend)
        backend->provide_ldisc(this);
}

Ldisc::~Ldisc()
{
    if (term)
        term->ldisc = NULL;
    if (backend)
        backend->provide_ldisc(nullptr);
}

void Ldisc::send_to_backend_raw(const void *vbuf, size_t len)
{
    backend->send((const char *) vbuf, len);
}

void Ldisc::send(const void *vbuf, int len, bool interactive)
{
    const char *buf = (const char *)vbuf;
    int keyflag = 0;

    if (interactive) {
        // Interrupt a paste from the clipboard, if one was in
        // progress when the user pressed a key. This is easier than
        // buffering the current piece of data and saving it until the
        // terminal has finished pasting, and has the potential side
        // benefit of permitting a user to cancel an accidental huge
        // paste.
        term->term_nopaste();
    }

    // len < 0 means null terminated special string.
    if (len < 0) {
        len = strlen(buf);
        keyflag = KCTRL('@');
    }

    if (!EDITING) {
        // If editing was just turned off and we had data being edited, backspace
        // over it to remove it before sending it as regular input.
        if (!input_buf.empty()) {
            send_to_backend_raw(input_buf.data(), input_buf.size());
            while (!input_buf.empty()) {
                bsb(plen(input_buf.back()));
                input_buf.pop_back();
            }
        }

        // Send the data normally.
        if (len > 0) {
            if (ECHOING)
                seat->output(buf, len);
            send_to_backend_raw(buf, len);
        }
        return;
    }

    // Local editing.
    while (len--)
    {
        int c = (unsigned char)(*buf++) + keyflag;
        if (!interactive && c == '\r')
            c += KCTRL('@');

        switch (quotenext ? ' ' : c) {
        case KCTRL('H'):
        case KCTRL('?'):         // backspace/delete
            // ^h/^?: delete, and output BSBs, to return to
            // last character boundary (in UTF-8 mode this may
            // be more than one byte)
            while(!input_buf.empty())
            {
                if (ECHOING)
                    bsb(plen(input_buf.back()));
                bool is_char_start = char_start(input_buf.back());
                input_buf.pop_back();
                if(is_char_start)
                    break;
            }
            break;

        case CTRL('W'):          // delete word
            // ^w: delete, and output BSBs, to return to last space/nonspace boundary
            while(!input_buf.empty())
            {
                if (ECHOING)
                    bsb(plen(input_buf.back()));

                bool was_space = isspace((unsigned char)input_buf.back());
                input_buf.pop_back();
                if(!was_space && !input_buf.empty() &&
                    isspace((unsigned char)input_buf.back()))
                    break;
            }
            break;

        case CTRL('U'):          // ^U: delete line
        case CTRL('C'):          // ^C: Send IP
        case CTRL('\\'):         // ^\: Quit
        case CTRL('Z'):          // ^Z: Suspend
            // ^U: delete, and output BSBs, to return to BOL
            // ^C: Do a ^u then send a telnet IP
            // ^\: Do a ^u then send a telnet ABORT
            // ^Z: Do a ^u then send a telnet SUSP
            while (!input_buf.empty()) {
                if (ECHOING)
                    bsb(plen(input_buf.back()));
                input_buf.pop_back();
            }
            break;

        case CTRL('R'):          // ^R: echo "^R\n" and redraw line
            if (ECHOING) {
                int i;
                seat->output("^R\r\n", 4);
                for(char c: input_buf)
                    pwrite(c);
            }
            break;
        case CTRL('V'):          // ^V: quote next char
            quotenext = true;
            break;
        case CTRL('D'):          // ^D: logout or send
            // ^D: if at BOL, end of file and close connection,
            // else send line and reset to BOL
            if (!input_buf.empty()) {
                send_to_backend_raw(input_buf.data(), input_buf.size());
                input_buf.clear();
            }

            break;
        // ^m: send line-plus-\r\n and reset to BOL
            /*
            * This particularly hideous bit of code from RDB
            * allows ordinary ^M^J to do the same thing as
            * magic-^M when in Raw protocol. The line `case
            * KCTRL('M'):' is _inside_ the if block. Thus:
            *
            *  - receiving regular ^M goes straight to the
            *    default clause and inserts as a literal ^M.
            *  - receiving regular ^J _not_ directly after a
            *    literal ^M (or not in Raw protocol) fails the
            *    if condition, leaps to the bottom of the if,
            *    and falls through into the default clause
            *    again.
            *  - receiving regular ^J just after a literal ^M
            *    in Raw protocol passes the if condition,
            *    deletes the literal ^M, and falls through
            *    into the magic-^M code
            *  - receiving a magic-^M empties the line buffer,
            *    signals end-of-line in one of the various
            *    entertaining ways, and _doesn't_ fall out of
            *    the bottom of the if and through to the
            *    default clause because of the break.
            */
        case CTRL('J'):
                if (protocol == PROT_RAW &&
                    !input_buf.empty() && input_buf.back() == '\r') {
                if (ECHOING)
                    bsb(plen(input_buf.back()));
                input_buf.pop_back();
                /* FALLTHROUGH */
        case KCTRL('M'):         /* send with newline */
                if (!input_buf.empty())
                    send_to_backend_raw(input_buf.data(), input_buf.size());
                if (protocol == PROT_RAW)
                    send_to_backend_raw("\r\n", 2);
                else
                    send_to_backend_raw("\r", 1);
                if (ECHOING)
                    seat->output("\r\n", 2);
                input_buf.clear();
                break;
            }
            /* FALLTHROUGH */
        default:                 // get to this label from ^V handler
            input_buf.push_back(c);
            if (ECHOING)
                pwrite((unsigned char) c);
            quotenext = false;
            break;
        }
    }
}
#endif
