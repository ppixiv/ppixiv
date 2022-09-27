/*
 * Internals of the Terminal structure, for those other modules
 * which need to look inside it. It would be nice if this could be
 * folded back into terminal.c in future, with an abstraction layer
 * to handle everything that other modules need to know about it;
 * but for the moment, this will do.
 */

#ifndef Terminal_H
#define Terminal_H

#include "misc.h"
#include "bufchain.h"
#include <list>
#include <vector>

class Client;

#define OSC4_NCOLORS 262              /* 256 + the same 6 special ones */

enum OSC4_Color
{
    // Standard 16 colors:
    OSC4_COLOR_black,
    OSC4_COLOR_red,
    OSC4_COLOR_green,
    OSC4_COLOR_yellow,
    OSC4_COLOR_blue,
    OSC4_COLOR_magenta,
    OSC4_COLOR_cyan,
    OSC4_COLOR_white,
    OSC4_COLOR_black_bold,
    OSC4_COLOR_red_bold,
    OSC4_COLOR_green_bold,
    OSC4_COLOR_yellow_bold,
    OSC4_COLOR_blue_bold,
    OSC4_COLOR_magenta_bold,
    OSC4_COLOR_cyan_bold,
    OSC4_COLOR_white_bold,

    // Colors 16-255 for OSC4:
    //
    //  - 216 colors forming a 6x6x6 cube, with R the most
    //    significant color and G the least. In other words, these
    //    occupy the space of indices 16 <= i < 232, with each
    //    individual color found as i = 16 + 36*r + 6*g + b, for all
    //    0 <= r,g,b <= 5.
    //
    //  - The remaining indices, 232 <= i < 256, consist of a uniform
    //    series of grey shades running between black and white (but
    //    not including either, since actual black and white are
    //    already provided in the previous color cube).
    //
    // After that, we have the remaining 6 special colors:
    OSC4_COLOR_fg = 256,
    OSC4_COLOR_fg_bold,
    OSC4_COLOR_bg,
    OSC4_COLOR_bg_bold,
    OSC4_COLOR_cursor_fg,
    OSC4_COLOR_cursor_bg,
};

/* Three attribute types:
 * The ATTRs (normal attributes) are stored with the characters in
 * the main display arrays
 *
 * The TATTRs (temporary attributes) are generated on the fly, they
 * can overlap with characters but not with normal attributes.
 *
 * The LATTRs (line attributes) are an entirely disjoint space of flags.
 *
 * The DATTRs (display attributes) are internal to terminal.c (but
 * defined here because their values have to match the others
 * here); they reuse the TATTR_* space but are always masked off
 * before sending to the front end.
 *
 * ATTR_INVALID is an illegal color combination.
 */

#define ATTR_NARROW  0x0800000U
#define ATTR_WIDE    0x0400000U
#define ATTR_BOLD    0x0040000U
#define ATTR_UNDER   0x0080000U
#define ATTR_REVERSE 0x0100000U
#define ATTR_BLINK   0x0200000U
#define ATTR_FGMASK  0x00001FFU /* stores a color in OSC 4 indexing */
#define ATTR_BGMASK  0x003FE00U /* stores a color in OSC 4 indexing */
#define ATTR_COLORS  0x003FFFFU
#define ATTR_DIM     0x1000000U
#define ATTR_STRIKE  0x2000000U
#define ATTR_FGSHIFT 0
#define ATTR_BGSHIFT 9

#define ATTR_DEFFG   (OSC4_COLOR_fg << ATTR_FGSHIFT)
#define ATTR_DEFBG   (OSC4_COLOR_bg << ATTR_BGSHIFT)
#define ATTR_DEFAULT (ATTR_DEFFG | ATTR_DEFBG)

#define TATTR_ACTCURS       0x40000000UL      /* active cursor (block) */
#define TATTR_PASCURS       0x20000000UL      /* passive cursor (box) */
#define TATTR_RIGHTCURS     0x10000000UL      /* cursor-on-RHS */
#define TATTR_COMBINING     0x80000000UL      /* combining characters */

#define DATTR_STARTRUN      0x80000000UL   /* start of redraw run */

#define TDATTR_MASK         0xF0000000UL
#define TATTR_MASK (TDATTR_MASK)
#define DATTR_MASK (TDATTR_MASK)

#define LATTR_NORM   0x00000000UL
#define LATTR_WIDE   0x00000001UL
#define LATTR_TOP    0x00000002UL
#define LATTR_BOT    0x00000003UL
#define LATTR_MODE   0x00000003UL
#define LATTR_WRAPPED 0x00000010UL     // this line wraps to next
#define LATTR_WRAPPED2 0x00000020UL    // with WRAPPED: CJK wide character wrapped to next line, so last single-width cell is empty

#define ATTR_INVALID 0x03FFFFU

// Use the DC00 page for direct to font.
#define CSET_ACP     0x0000DD00UL      // Ansi Codepage DTF

#define UCSERR       0x0000FFFDUL

// UCSWIDE is a special value used in the terminal data to signify
// the character cell containing the right-hand half of a CJK wide
// character. We use 0xDFFF because it's part of the surrogate
// range and hence won't be used for anything else (it's impossible
// to input it via UTF-8 because our UTF-8 decoder correctly
// rejects surrogates).
#define UCSWIDE      0xDFFF

// TerminalWindow is the interface from the terminal to the terminal window.
class TerminalInterface {
public:
    /*
     * All functions listed here between setup_draw_ctx and
     * free_draw_ctx expect to be _called_ between them too, so that
     * the TerminalInterface has a drawing context currently available.
     *
     * (Yes, even char_width, because e.g. the Windows implementation
     * of TerminalInterface handles it by loading the currently configured font
     * into the HDC and doing a GDI query.)
     */
    virtual bool setup_draw_ctx() = 0;

    // Draw text in the window, during a painting operation
    virtual void draw_text(int x, int y, wchar_t *text, int len, unsigned long attrs, int line_attrs, truecolor tc) = 0;
    
    /* Draw the visible cursor. Expects you to have called do_text
     * first (because it might just draw an underline over a character
     * presumed to exist already), but also expects you to pass in all
     * the details of the character under the cursor (because it might
     * redraw it in different colors). */
    virtual void draw_cursor(int x, int y, wchar_t *text, int len,
                        unsigned long attrs, int line_attrs, truecolor tc) = 0;
    virtual int get_char_width(int uc) = 0;
    virtual void free_draw_ctx() = 0;

    virtual void set_cursor_pos(int x, int y) = 0;

    /* set_raw_mouse_mode instructs the front end to start sending mouse events
     * in raw mode suitable for translating into mouse-tracking terminal data
     * (e.g. include scroll-wheel events and don't bother to identify double-
     * and triple-clicks). set_raw_mouse_mode_pointer instructs the front end
     * to change the mouse pointer shape to *indicate* raw mouse mode. */
    virtual void set_raw_mouse_mode(bool enable) = 0;
    virtual void set_raw_mouse_mode_pointer(bool enable) = 0;

    virtual void set_scrollbar(int total, int start, int page) = 0;

    virtual void clip_write(wchar_t *text, int len, bool must_deselect) = 0;
    virtual void clip_request_paste() = 0;

    virtual void refresh() = 0;

    virtual void request_resize(int w, int h) = 0;

    virtual void set_title(string title) = 0;

    virtual void move(int x, int y) = 0;

    /* Set the color palette that the TerminalInterface will use to display
     * text. One call to this function sets 'ncolors' consecutive
     * colors in the OSC 4 sequence, starting at 'start'. */
    virtual void palette_set(unsigned start, unsigned ncolors, const rgb *colors) = 0;
};





typedef struct {
    int y, x;
} pos;

typedef struct termchar termchar;
typedef struct termline termline;

struct termchar {
    /*
     * Any code in terminal.c which definitely needs to be changed
     * when extra fields are added here is labelled with a comment
     * saying FULL-TERMCHAR.
     */
    unsigned long chr;
    unsigned long attr;
    truecolor truecolor;

    /*
     * The cc_next field is used to link multiple termchars
     * together into a list, so as to fit more than one character
     * into a character cell (Unicode combining characters).
     *
     * cc_next is a relative offset into the current array of
     * termchars. I.e. to advance to the next character in a list,
     * one does `tc += tc->next'.
     *
     * Zero means end of list.
     */
    int cc_next;
};

struct termline {
    unsigned short lattr;
    int cols;                          /* number of real columns on the line */
    int size;                          /* number of allocated termchars
                                        * (cc-lists may make this > cols) */
    bool temporary;                    /* true if decompressed from scrollback */
    int cc_free;                       /* offset to first cc in free list */
    vector<termchar> chars;

    termline(int cols, bool bce, termchar erase_char);
    void clear_combining_character(int col);
    void add_combining_character(int col, unsigned long chr);
};

struct bidi_cache_entry {
    int width;
    struct termchar *chars;
    int *forward, *backward;           /* the permutations of line positions */
};

struct term_utf8_decode {
    int state;                         /* Is there a pending UTF-8 character */
    int chr;                           /* and what is it so far? */
    int size;                          /* The size of the UTF character. */
};

// XXX: move these back into terminal_tag
typedef enum {
    NO_SELECTION, ABOUT_TO, DRAGGING, SELECTED
} selstate_t;
typedef enum {
    LEXICOGRAPHIC, RECTANGULAR
} seltype_t;

class Terminal
{
public:
    void init(shared_ptr<const TermConfig> conf, TerminalInterface *win, shared_ptr<Client> client);

    void term_free();
    void term_size(int newcols, int newrows, int newsavelines);
    void term_paint(int left, int top, int right, int bottom, bool immediately);
    void term_scroll(int rel, int where);
    void term_scroll_to_selection(int which_end);
    void term_pwron(bool clear);
    void term_clrsb();
    void term_mouse_action(Mouse_Button, Mouse_Button, Mouse_Action, int, int, bool, bool, bool);
    void term_cancel_selection_drag();
    void term_lost_clipboard_ownership();
    void term_update();
    void term_invalidate();
    void term_blink(bool set_cursor);
    void term_do_paste(const wstring &data);
    void term_nopaste();
    void term_copyall();
    void term_reconfig(shared_ptr<const TermConfig> conf);
    void term_request_paste();
    void term_data(const void *data, size_t len);
    void term_set_focus(bool has_focus);
    void term_keyinput(int codepage, const char *buf, int len);
    void term_keyinputw(const wchar_t * widebuf, int len);
    void term_get_cursor_position(int *x, int *y);
    void term_setup_window_titles(string title_hostname);
    void term_notify_minimized(bool minimized);



    int compatibility_level;

    list<shared_ptr<termline>> scrollback;   // lines scrolled off top of screen
    list<shared_ptr<termline>> screen;       // lines on primary screen
    list<shared_ptr<termline>> alt_screen;   // lines on alternate screen
    int disptop;                       /* distance scrolled back (0 or -ve) */
    int tempsblines;                   /* number of lines of .scrollback that
                                          can be retrieved onto the terminal
                                          ("temporary scrollback") */

    vector<shared_ptr<termline>> disptext;  // buffer of text on real screen
    int dispcursx, dispcursy;          /* location of cursor on real screen */
    int curstype;                      /* type of cursor on real screen */

#define VBELL_TIMEOUT (TICKSPERSEC/10) /* visual bell lasts 1/10 sec */

#define TTYPE termchar
#define TSIZE (sizeof(TTYPE))

    int default_attr, curr_attr, save_attr;
    truecolor curr_truecolor, save_truecolor;
    termchar basic_erase_char, erase_char;

    bufchain inbuf;                    /* terminal input buffer */

    pos curs;                          /* cursor */
    pos savecurs;                      /* saved cursor position */
    int marg_t, marg_b;                /* scroll margins */
    bool wrapnext;                     /* wrap flags */
    bool insert;                       /* insert-mode flag */
    int cset;                          /* 0 or 1: which char set */
    bool save_wnext;                   /* saved with cursor position */
    bool rvideo;                       /* global reverse video flag */
    unsigned long rvbell_startpoint;   /* for ESC[?5hESC[?5l vbell */
    bool cursor_on;                    /* cursor enabled flag */
    bool reset_132;                    /* Flag ESC c resets to 80 cols */
    bool use_bce;                      /* Use Background colored erase */
    term_utf8_decode utf8;             /* If so, here's our decoding state */
    int print_state;                   /* state of print-end-sequence scan */

    /* ESC 7 saved state for the alternate screen */
    pos alt_savecurs;
    int alt_save_attr;
    truecolor alt_save_truecolor;
    bool alt_save_utf;
    bool alt_save_wnext;

    int rows, cols, savelines;
    bool has_focus;
    bool in_vbell;
    long vbell_end;
    bool app_cursor_keys, app_keypad_keys;
    bool repeat_off, srm_echo, cr_lf_return;
    bool seen_disp_event;

    int xterm_mouse;                   /* send mouse messages to host */
    bool xterm_extended_mouse;
    bool urxvt_extended_mouse;
    int mouse_is_down;                 /* used while tracking mouse buttons */

    // Saved settings on the alternate screen.
    int alt_x, alt_y;
    bool alt_wnext, alt_ins;
    int alt_cset;
    int alt_t, alt_b;
    int alt_which;
    int alt_sblines; /* # of lines on alternate screen that should be used for scrollback. */

#define ARGS_MAX 32                    /* max # of esc sequence arguments */
#define ARG_DEFAULT 0                  /* if an arg isn't specified */
#define def(a,d) ( (a) == ARG_DEFAULT ? (d) : (a) )
    unsigned esc_args[ARGS_MAX];
    int esc_nargs;
    int esc_query;
#define ANSI(x,y)       ((x)+((y)*256))
#define ANSI_QUE(x)     ANSI(x,1)

#define OSC_STR_MAX 2048
    int osc_strlen;
    char osc_string[OSC_STR_MAX + 1];
    bool osc_w;

    char id_string[1024];

    vector<bool> tabs;

    enum {
        TOPLEVEL,
        SEEN_ESC,
        SEEN_CSI,
        SEEN_OSC,
        SEEN_OSC_W,

        DO_CTRLS,

        OSC_STRING, OSC_MAYBE_ST, OSC_MAYBE_ST_UTF8,
    } termstate;

    selstate_t selstate;

    seltype_t seltype;
    enum {
        SM_CHAR, SM_WORD, SM_LINE
    } selmode;
    pos selstart, selend, selanchor;

    /* Mask of attributes to pay attention to when painting. */
    int attr_mask;

    string paste_buffer;
    int paste_pos;

    shared_ptr<Client> client;

    TerminalInterface *win;

    unsigned long last_graphic_char;

    /*
     * We maintain a full copy of a Conf here, not merely a pointer
     * to it. That way, when we're passed a new one for
     * reconfiguration, we can check the differences and adjust the
     * _current_ setting of (e.g.) auto wrap mode rather than only
     * the default.
     */
    shared_ptr<TermConfig>  conf;

    /*
     * GUI implementations of seat_output call term_out, but it can
     * also be called from the ldisc if the ldisc is called _within_
     * term_out. So we have to guard against re-entrancy - if
     * seat_output is called recursively like this, it will simply add
     * data to the end of the buffer term_out is in the process of
     * working through.
     */
    bool in_term_out;

    /*
     * We don't permit window updates too close together, to avoid CPU
     * churn pointlessly redrawing the window faster than the user can
     * read. So after an update, we set window_update_cooldown = true
     * and schedule a timer to reset it to false. In between those
     * times, window updates are not performed, and instead we set
     * window_update_pending = true, which will remind us to perform
     * the deferred redraw when the cooldown period ends and
     * window_update_cooldown is reset to false.
     */
    bool window_update_pending, window_update_cooldown;
    long window_update_cooldown_end;

    string window_title;
    bool minimized;

    rgb palette[OSC4_NCOLORS];

    /*
     * Assorted 'pending' flags for ancillary window changes performed
     * in term_update. Generally, to trigger one of these operations,
     * you set the pending flag and/or the parameters here, then call
     * term_schedule_update.
     */
    bool win_move_pending;
    int win_move_pending_x, win_move_pending_y;
    bool win_title_pending;
    bool win_pointer_shape_pending;
    bool win_pointer_shape_raw;
    bool win_refresh_pending;
    bool win_scrollbar_update_pending;

    /*
     * Unlike the rest of the above 'pending' flags, the one for
     * window resizing has to be more complicated, because it's very
     * likely that a server sending a window-resize escape sequence is
     * going to follow it up immediately with further terminal output
     * that draws a full-screen application expecting the terminal to
     * be the new size.
     *
     * So, once we've requested a window resize from the TerminalInterface, we
     * have to stop processing terminal data until we get back the
     * notification that our window really has changed size (or until
     * we find out that it's not going to).
     *
     * Hence, window resizes go through a small state machine with two
     * different kinds of 'pending'. NEED_SEND is the state where
     * we've received an escape sequence asking for a new size but not
     * yet sent it to the TerminalInterface via win_request_resize; AWAIT_REPLY
     * is the state where we've sent it to the TerminalInterface and are
     * expecting a call back to term_size().
     *
     * So _both_ of those 'pending' states inhibit terminal output
     * processing.
     *
     * (Hence, once we're in either state, we should never handle
     * another resize sequence, so the only possible path through this
     * state machine is to get all the way back to the ground state
     * before doing anything else interesting.)
     */
    enum {
        WIN_RESIZE_NO, WIN_RESIZE_NEED_SEND, WIN_RESIZE_AWAIT_REPLY
    } win_resize_pending;
    int win_resize_pending_w, win_resize_pending_h;

    /*
     * Not every frontend / TerminalInterface implementation can be relied on
     * 100% to reply to a resize request in a timely manner. (In X11
     * it's all asynchronous and goes via the window manager, and if
     * your window manager is seriously unwell, you'd rather not have
     * terminal windows start becoming unusable as a knock-on effect,
     * since those are just the thing you might need to use for
     * emergency WM maintenance!) So when we enter AWAIT_REPLY status,
     * we also set a 5-second timer, after which we'll regretfully
     * conclude that a resize is probably not going to happen after
     * all.
     *
     * However, in non-emergency cases, the plan is that this
     * shouldn't be needed, for one reason or another.
     */
    long win_resize_timeout;
    #define WIN_RESIZE_TIMEOUT (TICKSPERSEC*5)

private:
    shared_ptr<termline> get_line(list<shared_ptr<termline>> &lines, int y);
    shared_ptr<termline> get_and_remove_line(list<shared_ptr<termline>> &lines, int y);
    void insert_line(list<shared_ptr<termline>> &lines, shared_ptr<termline> line, int y);
    shared_ptr<termline> lineptr(int y, int screen_idx=0);
    shared_ptr<termline> scrlineptr(int y);
    int line_cols(shared_ptr<termline> ldata) const;

    void power_on(bool clear);
    void schedule_update();
    void check_line_size(shared_ptr<termline> line);
    void erase_lots(bool line_only, bool from_begin, bool to_end);
    void check_boundary(int x, int y);
    void check_selection(pos from, pos to);
    void sel_spread();
    pos sel_spread_half(pos p, int dir);
    void resizeline(shared_ptr<termline> line, int cols);
    void clear_line(shared_ptr<termline> line);
    void saw_disp_event();
    int find_last_nonempty_line(list<shared_ptr<termline>> screen);
    void clipme(pos top, pos bottom, bool rect, bool desel);

    void scroll(int topline, int botline, int lines, bool sb);
    int sblines() const;

    void deselect();
    int wordtype(int uc) const;

    string term_input_data_from_unicode(const wstring &buf);
    string term_input_data_from_charset(int codepage, const char *str, int len);

    static void term_out_hook(void *ctx);
    void term_out();
    void term_out_inner(unsigned long c);
    inline void term_write(ptrlen data) { term_data(data.ptr, data.len); }

    void term_added_data();
    void term_display_graphic_char(unsigned long c);

    void term_keyinput_internal(const char *buf, int len, bool interactive);

    static void term_paste_callback(void *ptr);
    void term_paste();

    void term_mouse(Mouse_Button braw, Mouse_Button bcooked,
        Mouse_Action a, int x, int y, bool shift, bool ctrl, bool alt);

    unsigned long term_translate(term_utf8_decode *utf8, unsigned char c);

    static void term_timer_hook(void *ptr, unsigned long now);
    void term_timer(unsigned long now);

    static void term_update_callback_hook(void *ptr);
    void term_update_callback();

    void term_schedule_vbell(bool already_started, long startpoint);

    void do_paint();
    void do_paint_draw(shared_ptr<termline> ldata, int x, int y,
        wchar_t *ch, int ccount, unsigned long attr, truecolor tc);
    void update_sbar();

    void term_update_raw_mouse_mode();
    void term_request_resize(int cols, int rows);
    void toggle_mode(int mode, int query, bool state);
    void move_cursor(int x, int y, int marg_clip);
    void save_cursor(bool save);
    void insch(int n);
    void set_erase_char();

    void palette_reset();

    void swap_screen(int which, bool reset, bool keep_cur_pos);

    void do_osc();

};

/*
 * UCSINCOMPLETE is returned from term_translate if it's successfully
 * absorbed a byte but not emitted a complete character yet.
 * UCSTRUNCATED indicates a truncated multibyte sequence (so the
 * caller emits an error character and then calls term_translate again
 * with the same input byte). UCSINVALID indicates some other invalid
 * multibyte sequence, such as an overlong synonym, or a standalone
 * continuation byte, or a completely illegal thing like 0xFE. These
 * values are not stored in the terminal data structures at all.
 */
#define UCSINCOMPLETE 0x8000003FU    /* '?' */
#define UCSTRUNCATED  0x80000021U    /* '!' */
#define UCSINVALID    0x8000002AU    /* '*' */

// Arbitrary maximum number of combining characters we're willing to store in a
// character cell.
#define CC_LIMIT 32

/* ----------------------------------------------------------------------
 * Helper functions for dealing with the small 'pos' structure.
 */

static inline bool poslt(pos p1, pos p2)
{
    if (p1.y != p2.y)
        return p1.y < p2.y;
    return p1.x < p2.x;
}

static inline bool posle(pos p1, pos p2)
{
    if (p1.y != p2.y)
        return p1.y < p2.y;
    return p1.x <= p2.x;
}

static inline bool poseq(pos p1, pos p2)
{
    return p1.y == p2.y && p1.x == p2.x;
}

static inline int posdiff_fn(pos p1, pos p2, int cols)
{
    return (p1.y - p2.y) * (cols+1) + (p1.x - p2.x);
}

#define posdiff(p1,p2) posdiff_fn(p1, p2, cols)

/* Product-order comparisons for rectangular block selection. */

static inline bool posPle(pos p1, pos p2)
{
    return p1.y <= p2.y && p1.x <= p2.x;
}

static inline bool posPle_left(pos p1, pos p2)
{
    /*
     * This function is used for checking whether a given character
     * cell of the terminal ought to be highlighted as part of the
     * selection, by comparing with term->selend. term->selend stores
     * the location one space to the right of the last highlighted
     * character. So we want to highlight the characters that are
     * less-or-equal (in the product order) to the character just left
     * of p2.
     *
     * (Setting up term->selend that way was the easiest way to get
     * rectangular selection working at all, in a code base that had
     * done lexicographic selection the way I happened to have done
     * it.)
     */
    return p1.y <= p2.y && p1.x < p2.x;
}

static inline bool incpos_fn(pos *p, int cols)
{
    if (p->x == cols) {
        p->x = 0;
        p->y++;
        return true;
    }
    p->x++;
    return false;
}

static inline bool decpos_fn(pos *p, int cols)
{
    if (p->x == 0) {
        p->x = cols;
        p->y--;
        return true;
    }
    p->x--;
    return false;
}

/* Convenience wrappers on incpos and decpos which use term->cols
 * (similarly to posdiff above), and also (for mild convenience and
 * mostly historical inertia) let you leave off the & at every call
 * site. */
#define incpos(p) incpos_fn(&(p), cols)
#define decpos(p) decpos_fn(&(p), cols)

#endif
