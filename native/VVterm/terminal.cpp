/*
 * Terminal emulator.
 */

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <limits.h>
#include <wchar.h>
#include <time.h>
#include <assert.h>

#include <algorithm>

#include "internal.h"
#include "unicode.h"
#include "terminal.h"
#include "client.h"
#include "callback.h"
#include "timing.h"
#include "wcwidth.h"

#define CL_ANSIMIN      0x0001         /* Codes in all ANSI like terminals. */
#define CL_VT100        0x0002         /* VT100 */
#define CL_VT100AVO     0x0004         /* VT100 +AVO; 132x24 (not 132x14) & attrs */
#define CL_VT102        0x0008         /* VT102 */
#define CL_VT220        0x0010         /* VT220 */
#define CL_VT320        0x0020         /* VT320 */
#define CL_VT420        0x0040         /* VT420 */
#define CL_VT340TEXT    0x0100         /* VT340 extensions that appear in the VT420 */
#define CL_SCOANSI      0x1000         /* SCOANSI not in ANSIMIN. */
#define CL_ANSI         0x2000         /* ANSI ECMA-48 not in the VT100..VT420 */
#define CL_OTHER        0x4000         /* Others, Xterm, linux, putty, dunno, etc */

#define TM_PUTTY        (0xFFFF)

#define UPDATE_DELAY    ((TICKSPERSEC+49)/50)/* ticks to defer window update */
#define VBELL_DELAY     (VBELL_TIMEOUT) /* visual bell timeout in ticks */

#define compatibility(x) \
    if ( (x&compatibility_level) == 0 ) {  \
       termstate = Terminal::TOPLEVEL;                        \
       break;                                           \
    }
#define compatibility2(x,y) \
    if ( ((x|y)&compatibility_level) == 0 ) { \
       termstate = Terminal::TOPLEVEL;                        \
       break;                                           \
    }

#define has_compat(x) ( ((CL_##x)&compatibility_level) != 0 )

static const char sco2ansicolor[] = { 0, 4, 2, 6, 1, 5, 3, 7 };

#define sel_nl_sz  (sizeof(sel_nl)/sizeof(wchar_t))
static const wchar_t sel_nl[] = { 13, 10 };

/*
 * Fetch the character at a particular position in a line array,
 * for purposes of `wordtype'. The reason this isn't just a simple
 * array reference is that if the character we find is UCSWIDE,
 * then we must look one space further to the left.
 */
#define UCSGET(a, x) \
    ( (x)>0 && (a)[(x)].chr == UCSWIDE ? (a)[(x)-1].chr : (a)[(x)].chr )

/*
 * Detect the various aliases of U+0020 SPACE.
 */
#define IS_SPACE_CHR(chr) ((chr) == 0x20)

const static short wordness[] = {
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,1,2,1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,
    1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,2,
    1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,
    2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,
};

/*
 * Internal prototypes.
 */
static void parse_optionalrgb(optionalrgb *out, unsigned *values);

termline::termline(int cols_, bool bce, termchar erase_char)
{
    cols = size = cols_;
    chars.resize(cols, erase_char);
    lattr = LATTR_NORM;
    temporary = false;
    cc_free = 0;
}

static shared_ptr<termline> newtermline(Terminal *term, int cols, bool bce)
{
    return make_shared<termline>(cols, bce, bce ? term->erase_char: term->basic_erase_char);
}

#ifdef TERM_CC_DIAGS
/*
 * Diagnostic function: verify that a termline has a correct
 * combining character structure.
 *
 * This is a performance-intensive check, so it's no longer enabled
 * by default.
 */
static void cc_check(const termline *line)
{
    int i, j;

    assert(line->size >= line->cols);

    vector<unsigned char> flags(line->size);

    for (i = 0; i < line->size; i++)
        flags[i] = (i < line->cols);

    for (i = 0; i < line->cols; i++) {
        j = i;
        while (line->chars[j].cc_next) {
            j += line->chars[j].cc_next;
            assert(j >= line->cols && j < line->size);
            assert(!flags[j]);
            flags[j] = true;
        }
    }

    j = line->cc_free;
    if (j) {
        while (1) {
            assert(j >= line->cols && j < line->size);
            assert(!flags[j]);
            flags[j] = true;
            if (line->chars[j].cc_next)
                j += line->chars[j].cc_next;
            else
                break;
        }
    }

    j = 0;
    for (i = 0; i < line->size; i++)
        j += (flags[i] != 0);

    assert(j == line->size);
}
#endif

/*
 * Add a combining character to a character cell.
 */
void termline::add_combining_character(int col, unsigned long chr)
{
    assert(col >= 0 && col < cols);

    /*
     * Don't add combining characters at all to U+FFFD REPLACEMENT
     * CHARACTER. (Partly it's a slightly incoherent idea in the first
     * place; mostly, U+FFFD is what we generate if a cell already has
     * too many ccs, in which case we want it to be a fixed point when
     * further ccs are added.)
     */
    if (chars[col].chr == 0xFFFD)
        return;

    /*
     * Walk the cc list of the cell in question to find its current
     * end point.
     */
    size_t ncc = 0;
    int origcol = col;
    while (chars[col].cc_next) {
        col += chars[col].cc_next;
        if (++ncc >= CC_LIMIT) {
            /*
             * There are already too many combining characters in this
             * character cell. Change strategy: throw out the entire
             * chain and replace the main character with U+FFFD.
             *
             * (Rationale: extrapolating from UTR #36 section 3.6.2
             * suggests the principle that it's better to substitute
             * U+FFFD than to _ignore_ input completely. Also, if the
             * user copies and pastes an overcombined character cell,
             * this way it will clearly indicate that we haven't
             * reproduced the writer's original intentions, instead of
             * looking as if it was the _writer's_ fault that the 33rd
             * cc is missing.)
             *
             * Per the code above, this will also prevent any further
             * ccs from being added to this cell.
             */
            clear_combining_character(origcol);
            chars[origcol].chr = 0xFFFD;
            return;
        }
    }

    /*
     * Extend the cols array if the free list is empty.
     */
    if (!cc_free) {
        int n = size;
        chars.resize(chars.size()+1);
        size = chars.size();

        cc_free = n;
        while (n < size) {
            if (n+1 < size)
                chars[n].cc_next = 1;
            else
                chars[n].cc_next = 0;
            n++;
        }
    }

    /*
     * `col' now points at the last cc currently in this cell; so
     * we simply add another one.
     */
    int newcc = cc_free;
    if (chars[newcc].cc_next)
        cc_free = newcc + chars[newcc].cc_next;
    else
        cc_free = 0;
    chars[newcc].cc_next = 0;
    chars[newcc].chr = chr;
    chars[col].cc_next = newcc - col;

#ifdef TERM_CC_DIAGS
    cc_check(this);
#endif
}

/*
 * Clear the combining character list in a character cell.
 */
void termline::clear_combining_character(int col)
{
    assert(col >= 0 && col < cols);

    if (!chars[col].cc_next)
        return;                        // nothing to do

    int origcol = col;
    int oldfree = cc_free;
    cc_free = col + chars[col].cc_next;
    while (chars[col].cc_next)
        col += chars[col].cc_next;
    if (oldfree)
        chars[col].cc_next = oldfree - col;
    else
        chars[col].cc_next = 0;

    chars[origcol].cc_next = 0;

#ifdef TERM_CC_DIAGS
    cc_check(this);
#endif
}

/*
 * Compare two character cells for equality. Special case required
 * in do_paint() where we override what we expect the chr and attr
 * fields to be.
 */
static bool termchars_equal_override(termchar *a, termchar *b,
                                     unsigned long bchr, unsigned long battr)
{
    /* FULL-TERMCHAR */
    if (!truecolor_equal(a->truecolor, b->truecolor))
        return false;
    if (a->chr != bchr)
        return false;
    if ((a->attr &~ DATTR_MASK) != (battr &~ DATTR_MASK))
        return false;
    while (a->cc_next || b->cc_next) {
        if (!a->cc_next || !b->cc_next)
            return false;              /* one cc-list ends, other does not */
        a += a->cc_next;
        b += b->cc_next;
        if (a->chr != b->chr)
            return false;
    }
    return true;
}

static bool termchars_equal(termchar *a, termchar *b)
{
    return termchars_equal_override(a, b, b->chr, b->attr);
}

/*
 * Copy a character cell. (Requires a pointer to the destination
 * termline, so as to access its free list.)
 */
static void copy_termchar(shared_ptr<termline> destline, int x, termchar *src)
{
    destline->clear_combining_character(x);

    destline->chars[x] = *src;         /* copy everything except cc-list */
    destline->chars[x].cc_next = 0;    /* and make sure this is zero */

    while (src->cc_next) {
        src += src->cc_next;
        destline->add_combining_character(x, src->chr);
    }

#ifdef TERM_CC_DIAGS
    cc_check(destline);
#endif
}

// Move a character cell within its termline.
// XXX test
static void move_termchar(shared_ptr<termline> line, int dstpos, int srcpos)
{
    /* First clear the cc list from the original char, just in case. */
    line->clear_combining_character(dstpos);

    /* Move the character cell and adjust its cc_next. */
    termchar &dst = line->chars[dstpos];
    termchar &src = line->chars[srcpos];

    dst = src;                      // copy everything except cc-list
    if(src.cc_next)
        dst.cc_next = src.cc_next - (dstpos-srcpos);

    // Ensure the original cell doesn't have a cc list.
    src.cc_next = 0;

#ifdef TERM_CC_DIAGS
    cc_check(line);
#endif
}

/*
 * Resize a line to make it `cols' columns wide.
 */
void Terminal::resizeline(shared_ptr<termline> line, int cols)
{
    int i, oldcols;

    if (line->cols != cols) {

        oldcols = line->cols;

        /*
         * This line is the wrong length, which probably means it
         * hasn't been accessed since a resize. Resize it now.
         *
         * First, go through all the characters that will be thrown
         * out in the resize (if we're shrinking the line) and
         * return their cc lists to the cc free list.
         */
        for (i = cols; i < oldcols; i++)
            line->clear_combining_character(i);

        /*
         * If we're shrinking the line, we now bodily move the
         * entire cc section from where it started to where it now
         * needs to be. (We have to do this before the resize, so
         * that the data we're copying is still there. However, if
         * we're expanding, we have to wait until _after_ the
         * resize so that the space we're copying into is there.)
         * 
         * Don't do this if there's no data to move, since it can
         * access the array past the end, which will assert even though
         * we're not actually doing anything with the pointer.
         */
        if (line->size != line->cols && cols < oldcols)
            memmove(&line->chars[cols], &line->chars[oldcols],
                    (line->size - line->cols) * TSIZE);

        /*
         * Now do the actual resize, leaving the _same_ amount of
         * cc space as there was to begin with.
         */
        line->size += cols - oldcols;
        line->chars.resize(line->size);
        line->cols = cols;

        /*
         * If we're expanding the line, _now_ we move the cc
         * section.
         */
        if (line->size != line->cols && cols > oldcols && line->size - line->cols > 0)
            memmove(&line->chars[cols], &line->chars[oldcols],
                    (line->size - line->cols) * TSIZE);

        /*
         * Go through what's left of the original line, and adjust
         * the first cc_next pointer in each list. (All the
         * subsequent ones are still valid because they are
         * relative offsets within the cc block.) Also do the same
         * to the head of the cc_free list.
         */
        for (i = 0; i < oldcols && i < cols; i++)
            if (line->chars[i].cc_next)
                line->chars[i].cc_next += cols - oldcols;
        if (line->cc_free)
            line->cc_free += cols - oldcols;

        /*
         * And finally fill in the new space with erase chars. (We
         * don't have to worry about cc lists here, because we
         * _know_ the erase char doesn't have one.)
         */
        for (i = oldcols; i < cols; i++)
            line->chars[i] = basic_erase_char;

#ifdef TERM_CC_DIAGS
        cc_check(line);
#endif
    }
}

/*
 * Get the number of lines in the scrollback.
 */
int Terminal::sblines() const
{
    int sblines = scrollback.size();
    if (alt_which)
        sblines += alt_sblines;
    return sblines;
}

// XXX: these should be fast for accessing the last line too (they're not)
shared_ptr<termline> Terminal::get_line(list<shared_ptr<termline>> &lines, int y)
{
    // We use a linked list to store scrollback.  This is quick for adding and
    // removing entries at the edges, and can look up blocks of sequential lines quickly,
    // but we have to iterate to find a specific line.
    auto it = lines.begin();
    while(y-- && it != lines.end())
        it++;

    assert(it != lines.end());

    return *it;
}

shared_ptr<termline> Terminal::get_and_remove_line(list<shared_ptr<termline>> &lines, int y)
{
    auto it = lines.begin();
    while(y-- && it != lines.end())
        it++;

    assert(it != lines.end());

    shared_ptr<termline> result = *it;
    lines.erase(it);
    return result;
}

// Insert line at lines[y].
//
// This is only needed when inserting in the middle.  For most operations that just add at the
// beginning or end, just use lines.push_front and lines.push_back.
void Terminal::insert_line(list<shared_ptr<termline>> &lines, shared_ptr<termline> line, int y)
{
    auto it = lines.begin();
    while(y-- && it != lines.end())
        it++;

    lines.insert(it, line);
}

shared_ptr<termline> Terminal::scrlineptr(int y)
{
    return lineptr(y, 1);
}

/*
 * Retrieve a line of the screen or of the scrollback, according to
 * whether the y coordinate is non-negative or negative
 * (respectively).
 */
shared_ptr<termline> Terminal::lineptr(int y, int screen_idx)
{
    list<shared_ptr<termline>> *whichtree;
    int treeindex;

    if (y >= 0) {
        whichtree = &screen;
        treeindex = y;
    } else {
        assert(!screen_idx);

        int altlines = alt_which? alt_sblines:0;
        if (y < -altlines) {
            whichtree = &scrollback;
            treeindex = y + altlines + scrollback.size();
        } else {
            whichtree = &alt_screen;
            treeindex = y + alt_sblines;
        }
    }
    shared_ptr<termline> line = get_line(*whichtree, treeindex);

    /*
     * Here we resize lines to _at least_ the right length, but we
     * don't truncate them. Truncation is done as a side effect of
     * modifying the line.
     *
     * The point of this policy is to try to arrange that resizing the
     * terminal window repeatedly - e.g. successive steps in an X11
     * opaque window-resize drag, or resizing as a side effect of
     * retiling by tiling WMs such as xmonad - does not throw away
     * data gratuitously. Specifically, we want a sequence of resize
     * operations with no terminal output between them to have the
     * same effect as a single resize to the ultimate terminal size,
     * and also (for the case in which xmonad narrows a window that's
     * scrolling things) we want scrolling up new text at the bottom
     * of a narrowed window to avoid truncating lines further up when
     * the window is re-widened.
     */
    if (cols > line->cols)
        resizeline(line, cols);

    return line;
}

/*
 * Coerce a termline to the terminal's current width. Unlike the
 * optional resize in lineptr() above, this is potentially destructive
 * of text, since it can shrink as well as grow the line.
 *
 * We call this whenever a termline is actually going to be modified.
 * Helpfully, putting a single call to this function in check_boundary
 * deals with _nearly_ all such cases, leaving only a few things like
 * bulk erase and ESC#8 to handle separately.
 */
void Terminal::check_line_size(shared_ptr<termline> line)
{
    if(cols != line->cols)      // trivial optimization
        resizeline(line, cols);
}

void Terminal::term_timer_hook(void *ptr, unsigned long now)
{
    Terminal *term = (Terminal *) ptr;
    term->term_timer(now);
}

void Terminal::term_timer(unsigned long now)
{
    if(in_vbell && now == vbell_end) {
        in_vbell = false;
        window_update_pending = true;
    }

    if (window_update_cooldown && now == window_update_cooldown_end)
        window_update_cooldown = false;

    if (window_update_pending)
        term_update_callback();

    if (win_resize_pending == Terminal::WIN_RESIZE_AWAIT_REPLY && now == win_resize_timeout) {
        win_resize_pending = Terminal::WIN_RESIZE_NO;
        callback::post(term_out_hook, this);
    }
}

void Terminal::term_update_callback_hook(void *ptr)
{
    Terminal *term = (Terminal *) ptr;
    term->term_update_callback();
}

void Terminal::term_update_callback()
{
    if (!window_update_pending)
        return;
    if (!window_update_cooldown) {
        term_update();
        window_update_cooldown = true;
        window_update_cooldown_end = schedule_timer(UPDATE_DELAY, term_timer_hook, this);
    }
}

void Terminal::schedule_update()
{
    if(window_update_pending)
        return;

    window_update_pending = true;
    callback::post(term_update_callback_hook, this);
}

// Call this whenever the terminal window state changes, to queue
// an update.
void Terminal::saw_disp_event()
{
    seen_disp_event = true;      // for scrollback-reset-on-activity
    schedule_update();
}

/*
 * Call to begin a visual bell.
 */
void Terminal::term_schedule_vbell(bool already_started, long startpoint)
{
    long ticks_already_gone = 0;
    if (already_started)
        ticks_already_gone = GetTickCount() - startpoint;

    if (ticks_already_gone < VBELL_DELAY) {
        in_vbell = true;
        vbell_end = schedule_timer(VBELL_DELAY - ticks_already_gone, term_timer_hook, this);
    } else {
        in_vbell = false;
    }
}

/*
 * Set up power-on settings for the terminal.
 * If 'clear' is false, don't actually clear the primary screen, and
 * position the cursor below the last non-blank line (scrolling if
 * necessary).
 */
void Terminal::power_on(bool clear)
{
    alt_x = alt_y = 0;
    savecurs.x = savecurs.y = 0;
    alt_savecurs.x = alt_savecurs.y = 0;
    alt_t = marg_t = 0;
    if (rows != -1)
        alt_b = marg_b = rows - 1;
    else
        alt_b = marg_b = 0;
    if (cols != -1) {
        int i;
        for (i = 0; i < cols; i++)
            tabs[i] = (i % 8 == 0 ? true : false);
    }
    alt_ins = false;
    insert = false;
    alt_wnext = false;
    wrapnext = false;
    save_wnext = false;
    alt_save_wnext = false;
    alt_cset = cset = 0;
    alt_save_utf = false;
    utf8.state = 0;
    rvideo = false;
    in_vbell = false;
    cursor_on = true;
    default_attr = save_attr = alt_save_attr = curr_attr = ATTR_DEFAULT;
    curr_truecolor.fg = curr_truecolor.bg = optionalrgb_none;
    save_truecolor = alt_save_truecolor = curr_truecolor;
    app_cursor_keys = false;
    app_keypad_keys = false;
    use_bce = true;
    erase_char = basic_erase_char;
    alt_which = 0;
    xterm_mouse = 0;
    xterm_extended_mouse = false;
    urxvt_extended_mouse = false;
    win->set_raw_mouse_mode(false);
    win_pointer_shape_pending = true;
    win_pointer_shape_raw = false;
    srm_echo = false;

    {
        swap_screen(1, false, false);
        erase_lots(false, true, true);
        swap_screen(0, false, false);
        if (clear)
            erase_lots(false, true, true);
        curs.y = find_last_nonempty_line(screen) + 1;
        if (curs.y == rows) {
            curs.y--;
            scroll(0, rows - 1, 1, true);
        }
    }

    curs.x = 0;
    schedule_update();
}

/*
 * Force a screen update.
 */
void Terminal::term_update()
{
    window_update_pending = false;

    if (win_move_pending) {
        win->move(win_move_pending_x, win_move_pending_y);
        win_move_pending = false;
    }
    if (win_resize_pending == Terminal::WIN_RESIZE_NEED_SEND) {
        win_resize_pending = Terminal::WIN_RESIZE_AWAIT_REPLY;
        win->request_resize(win_resize_pending_w, win_resize_pending_h);
        win_resize_timeout = schedule_timer(WIN_RESIZE_TIMEOUT, term_timer_hook, this);
    }
    if (win_title_pending) {
        win->set_title(window_title);
        win_title_pending = false;
    }
    if (win_pointer_shape_pending) {
        win->set_raw_mouse_mode_pointer(win_pointer_shape_raw);
        win_pointer_shape_pending = false;
    }
    if (win_refresh_pending) {
        win->refresh();
        win_refresh_pending = false;
    }

    if (win->setup_draw_ctx()) {
        bool need_sbar_update = seen_disp_event || win_scrollbar_update_pending;
        win_scrollbar_update_pending = false;
        if (seen_disp_event) {
            disptop = 0;         /* return to main screen */
            seen_disp_event = false;
            need_sbar_update = true;
        }

        if (need_sbar_update)
            update_sbar();
        do_paint();
        win->set_cursor_pos(curs.x, curs.y - disptop);
        win->free_draw_ctx();
    }
}

/*
 * Same as power_on(), but an external function.
 */
void Terminal::term_pwron(bool clear)
{
    power_on(clear);
    disptop = 0;
    deselect();
    term_update();
}

void Terminal::set_erase_char()
{
    erase_char = basic_erase_char;
    if (use_bce) {
        erase_char.attr = (curr_attr & (ATTR_FGMASK | ATTR_BGMASK));
        erase_char.truecolor.bg = curr_truecolor.bg;
    }
}

/*
 * When the user reconfigures us, we need to check the forbidden-
 * alternate-screen config option, disable raw mouse mode if the
 * user has disabled mouse reporting, and abandon a print job if
 * the user has disabled printing.
 */
void Terminal::term_reconfig(shared_ptr<const TermConfig> new_conf)
{
    /*
     * Before adopting the new config, check all those terminal
     * settings which control power-on defaults; and if they've
     * changed, we will modify the current state as well as the
     * default one. The full list is: Auto wrap mode, DEC Origin
     * Mode, BCE, character classes.
     */
    if(new_conf->wintitle != conf->wintitle)
    {
        window_title = new_conf->wintitle;
        win_title_pending = true;
        schedule_update();
    }

    conf = make_shared<TermConfig>(*new_conf);

    term_update_raw_mouse_mode();
}

/*
 * Clear the scrollback.
 */
void Terminal::term_clrsb()
{
    // Scroll forward to the current screen, if we were back in the
    // scrollback somewhere until now.
    disptop = 0;

    // Clear the actual scrollback.
    scrollback.clear();

    /*
     * When clearing the scrollback, we also truncate any termlines on
     * the current screen which have remembered data from a previous
     * larger window size. Rationale: clearing the scrollback is
     * sometimes done to protect privacy, so the user intention is
     * specifically that we should not retain evidence of what
     * previously happened in the terminal, and that ought to include
     * evidence to the right as well as evidence above.
     */
    for(int i = 0; i < rows; i++)
        check_line_size(scrlineptr(i));

    /*
     * That operation has invalidated the selection, if it overlapped
     * the scrollback at all.
     */
    if (selstate != NO_SELECTION && selstart.y < 0)
        deselect();

    /*
     * There are now no lines of real scrollback which can be pulled
     * back into the screen by a resize, and no lines of the alternate
     * screen which should be displayed as if part of the scrollback.
     */
    tempsblines = 0;
    alt_sblines = 0;

    /*
     * The scrollbar will need updating to reflect the new state of
     * the world.
     */
    win_scrollbar_update_pending = true;
    schedule_update();
}

const optionalrgb optionalrgb_none = {0, 0, 0, 0};

void Terminal::term_setup_window_titles(string title_hostname)
{
    if(!conf->wintitle.empty())
        window_title = conf->wintitle;
    else
        window_title = title_hostname.empty()? title_hostname:wstring_to_utf8(appname);

    win_title_pending = true;
}

static const rgb default_colors[] = {
    { 0,0,0 }, // black
    { 187,0,0 }, // red
    { 0,187,0 }, // green
    { 187,187,0 }, // yellow
    { 0,0,187 }, // blue
    { 187,0,187 }, // magenta
    { 0,187,187 }, // cyan
    { 187,187,187 }, // white
    { 85,85,85 }, // black_bold
    { 255,85,85 }, // red_bold
    { 85,255,85 }, // green_bold
    { 255,255,85 }, // yellow_bold
    { 85,85,255 }, // blue_bold
    { 255,85,255 }, // magenta_bold
    { 85,255,255 }, // cyan_bold
    { 255,255,255 }, // white_bold
};

/*
 * Rebuild the palette from configuration and platform colors.
 * If 'keep_overrides' set, any escape-sequence-specified overrides will
 * remain in place.
 */
void Terminal::palette_reset()
{
    for(unsigned i = 0; i < 16; i++)
        palette[i] = default_colors[i];

    palette[OSC4_COLOR_fg] = palette[OSC4_COLOR_white];
    palette[OSC4_COLOR_fg_bold] = palette[OSC4_COLOR_white_bold];
    palette[OSC4_COLOR_bg] = palette[OSC4_COLOR_black];
    palette[OSC4_COLOR_bg_bold] = palette[OSC4_COLOR_black_bold];
    palette[OSC4_COLOR_cursor_fg] = { 0,0,0 };
    palette[OSC4_COLOR_cursor_bg] = { 0,255,0 };

    // Directly invent the rest of the xterm-256 colors.
    for (unsigned i = 0; i < 216; i++) {
        rgb *col = &palette[i + 16];
        int r = i / 36, g = (i / 6) % 6, b = i % 6;
        col->r = r ? r * 40 + 55 : 0;
        col->g = g ? g * 40 + 55 : 0;
        col->b = b ? b * 40 + 55 : 0;
    }
    for (unsigned i = 0; i < 24; i++) {
        rgb *col = &palette[i + 232];
        int shade = i * 10 + 8;
        col->r = col->g = col->b = shade;
    }

    win->palette_set(0, OSC4_NCOLORS, palette);
    term_invalidate();
}

/*
 * Initialize the terminal.
 */
void Terminal::init(shared_ptr<const TermConfig> myconf, TerminalInterface *win_, shared_ptr<Client> client_)
{
    Terminal *term = this;

    term->win = win_;
    term->conf = make_shared<TermConfig>(*myconf);
    client = client_;

    term->compatibility_level = TM_PUTTY;
    strcpy(term->id_string, "\033[?6c");
    term->cr_lf_return = false;
    term->seen_disp_event = false;
    term->mouse_is_down = 0;
    term->reset_132 = false;
    term->has_focus = true;
    term->repeat_off = false;
    term->termstate = Terminal::TOPLEVEL;
    term->selstate = NO_SELECTION;
    term->curstype = 0;

    term->tempsblines = 0;
    term->alt_sblines = 0;
    term->disptop = 0;
    term->dispcursx = term->dispcursy = -1;
    deselect();
    term->rows = term->cols = -1;
    power_on(true);
    term->attr_mask = 0xffffffff;
    term->in_term_out = false;

    term->window_update_pending = false;
    term->window_update_cooldown = false;

    /* FULL-TERMCHAR */
    term->basic_erase_char.chr = ' ';
    term->basic_erase_char.attr = ATTR_DEFAULT;
    term->basic_erase_char.cc_next = 0;
    term->basic_erase_char.truecolor.fg = optionalrgb_none;
    term->basic_erase_char.truecolor.bg = optionalrgb_none;
    term->erase_char = term->basic_erase_char;

    term->last_graphic_char = 0;

    term->window_title = "";
    term->minimized = false;

    term->win_move_pending = false;
    term->win_resize_pending = Terminal::WIN_RESIZE_NO;
    term->win_title_pending = false;
    term->win_pointer_shape_pending = false;
    term->win_refresh_pending = false;
    term->win_scrollbar_update_pending = false;

    palette_reset();
}

void Terminal::term_free()
{
    shared_ptr<termline> line;

    scrollback.clear();
    screen.clear();
    alt_screen.clear();
    disptext.clear();
    inbuf.clear();
    paste_buffer.clear();
    tabs.clear();

    expire_timer_context(this);
    callback::delete_callbacks_for_context(this);
}

void Terminal::term_get_cursor_position(int *x, int *y)
{
    *x = curs.x;
    *y = curs.y;
}

/*
 * Set up the terminal for a given size.
 */
void Terminal::term_size(int newcols, int newrows, int newsavelines)
{
    int i, j, oldrows = rows;
    int save_alt_which = alt_which;

    /* If we were holding buffered terminal data because we were
     * waiting for confirmation of a resize, queue a callback to start
     * processing it again. */
    if (win_resize_pending == Terminal::WIN_RESIZE_AWAIT_REPLY) {
        win_resize_pending = Terminal::WIN_RESIZE_NO;
        callback::post(term_out_hook, this);
    }

    if (newrows == rows && newcols == cols && newsavelines == savelines)
        return;                        /* nothing to do */

    /* Behave sensibly if we're given zero (or negative) rows/cols */

    if (newrows < 1) newrows = 1;
    if (newcols < 1) newcols = 1;

    deselect();
    swap_screen(0, false, false);

    alt_t = marg_t = 0;
    alt_b = marg_b = newrows - 1;

    if (rows == -1) {
        scrollback.clear();
        screen.clear();
        tempsblines = 0;
        rows = 0;
    }

    /*
     * Resize the screen and scrollback. We only need to shift
     * lines around within our data structures, because lineptr()
     * will take care of resizing each individual line if
     * necessary. So:
     *
     *  - If the new screen is longer, we shunt lines in from temporary
     *    scrollback if possible, otherwise we add new blank lines at
     *    the bottom.
     *
     *  - If the new screen is shorter, we remove any blank lines at
     *    the bottom if possible, otherwise shunt lines above the cursor
     *    to scrollback if possible, otherwise delete lines below the
     *    cursor.
     *
     *  - Then, if the new scrollback length is less than the
     *    amount of scrollback we actually have, we must throw some
     *    away.
     */
    int sblen = scrollback.size();
    /* Do this loop to expand the screen if newrows > rows */
    assert(rows == screen.size());
    while (rows < newrows) {
        if (tempsblines > 0) {
            // Insert a line from the scrollback at the top of the screen.
            assert(sblen >= tempsblines);
            shared_ptr<termline> line = get_and_remove_line(scrollback, --sblen);
            line->temporary = false;   /* reconstituted line is now real */
            tempsblines -= 1;
            screen.push_front(line);
            curs.y += 1;
            savecurs.y += 1;
            alt_y += 1;
            alt_savecurs.y += 1;
        } else {
            /* Add a new blank line at the bottom of the screen. */
            shared_ptr<termline> line = newtermline(this, newcols, false);
            screen.push_back(line);
        }
        rows += 1;
    }
    /* Do this loop to shrink the screen if newrows < rows */
    while (rows > newrows) {
        if (curs.y < rows - 1) {
            // delete bottom row, unless it contains the cursor
            get_and_remove_line(screen, rows - 1);
        } else {
            // push top row to scrollback
            shared_ptr<termline> line = get_and_remove_line(screen, 0);
            scrollback.push_back(line);
            sblen++;
            tempsblines += 1;
            curs.y -= 1;
            savecurs.y -= 1;
            alt_y -= 1;
            alt_savecurs.y -= 1;
        }
        rows -= 1;
    }
    assert(rows == newrows);
    // XXX: screen.size() is O(n)
    assert(screen.size() == newrows);

    /* Delete any excess lines from the scrollback. */
    while (sblen > newsavelines) {
        get_and_remove_line(scrollback, 0);
        sblen--;
    }
    if (sblen < tempsblines)
        tempsblines = sblen;
    assert(scrollback.size() <= newsavelines);
    assert(scrollback.size() >= tempsblines);
    disptop = 0;

    /* Make a new displayed text buffer. */
    vector<shared_ptr<termline>> newdisp;
    newdisp.resize(newrows);
    for (i = 0; i < newrows; i++) {
        newdisp[i] = newtermline(this, newcols, false);
        for (j = 0; j < newcols; j++)
            newdisp[i]->chars[j].attr = ATTR_INVALID;
    }
    disptext = newdisp;
    dispcursx = dispcursy = -1;

    // Make a new alternate screen.
    alt_screen.clear();
    for (i = 0; i < newrows; i++) {
        shared_ptr<termline> line = newtermline(this, newcols, true);
        alt_screen.push_back(line);
    }
    alt_sblines = 0;

    tabs.clear();
    for (int i = (cols > 0 ? cols : 0); i < newcols; i++)
        tabs.push_back(i % 8 == 0);

    /* Check that the cursor positions are still valid. */
    if (savecurs.y < 0)
        savecurs.y = 0;
    if (savecurs.y >= newrows)
        savecurs.y = newrows - 1;
    if (savecurs.x >= newcols)
        savecurs.x = newcols - 1;
    if (alt_savecurs.y < 0)
        alt_savecurs.y = 0;
    if (alt_savecurs.y >= newrows)
        alt_savecurs.y = newrows - 1;
    if (alt_savecurs.x >= newcols)
        alt_savecurs.x = newcols - 1;
    if (curs.y < 0)
        curs.y = 0;
    if (curs.y >= newrows)
        curs.y = newrows - 1;
    if (curs.x >= newcols)
        curs.x = newcols - 1;
    if (alt_y < 0)
        alt_y = 0;
    if (alt_y >= newrows)
        alt_y = newrows - 1;
    if (alt_x >= newcols)
        alt_x = newcols - 1;
    alt_x = alt_y = 0;
    wrapnext = false;
    alt_wnext = false;

    rows = newrows;
    cols = newcols;
    savelines = newsavelines;

    swap_screen(save_alt_which, false, false);

    win_scrollbar_update_pending = true;
    schedule_update();
    if(client)
        client->size(cols, rows);
}

/* Find the bottom line on the screen that has any content.
 * If only the top line has content, returns 0.
 * If no lines have content, return -1.
 */
int Terminal::find_last_nonempty_line(list<shared_ptr<termline>> screen)
{
    int lineno = screen.size() - 1;
    for(auto it = screen.rbegin(); it != screen.rend(); ++it)
    {
        shared_ptr<termline> line = *it;
        int j;
        for (j = 0; j < line->cols; j++)
            if(!termchars_equal(&line->chars[j], &erase_char))
                break;
        if(j != line->cols)
            return lineno;

        lineno--;
    }

    return -1;
}

/*
 * Swap screens. If `reset' is true and we have been asked to
 * switch to the alternate screen, we must bring most of its
 * configuration from the main screen and erase the contents of the
 * alternate screen completely. (This is even true if we're already
 * on it! Blame xterm.)
 */
void Terminal::swap_screen(int which, bool reset, bool keep_cur_pos)
{
    int t;
    bool bt;
    pos tp;
    truecolor ttc;

    if (!which)
        reset = false;                 /* do no weird resetting if which==0 */

    if (which != alt_which) {
        if (alt_which && disptop < 0) {
            /*
             * We're swapping away from the alternate screen, so some
             * lines are about to vanish from the virtual scrollback.
             * Adjust disptop by that much, so that (if we're not
             * resetting the scrollback anyway on a display event) the
             * current scroll position still ends up pointing at the
             * same text.
             */
            disptop += alt_sblines;
            if (disptop > 0)
                disptop = 0;
        }

        alt_which = which;

        swap(screen, alt_screen);

        alt_sblines = find_last_nonempty_line(alt_screen) + 1;
        t = curs.x;
        if (!reset && !keep_cur_pos)
            curs.x = alt_x;
        alt_x = t;
        t = curs.y;
        if (!reset && !keep_cur_pos)
            curs.y = alt_y;
        alt_y = t;
        t = marg_t;
        if (!reset) marg_t = alt_t;
        alt_t = t;
        t = marg_b;
        if (!reset) marg_b = alt_b;
        alt_b = t;
        bt = wrapnext;
        if (!reset) wrapnext = alt_wnext;
        alt_wnext = bt;
        bt = insert;
        if (!reset) insert = alt_ins;
        alt_ins = bt;
        t = cset;
        if (!reset) cset = alt_cset;
        alt_cset = t;
        tp = savecurs;
        if (!reset)
            savecurs = alt_savecurs;
        alt_savecurs = tp;
        t = save_attr;
        if (!reset)
            save_attr = alt_save_attr;
        alt_save_attr = t;
        ttc = save_truecolor;
        if (!reset)
            save_truecolor = alt_save_truecolor;
        alt_save_truecolor = ttc;
        bt = save_wnext;
        if (!reset)
            save_wnext = alt_save_wnext;
        alt_save_wnext = bt;

        if (alt_which && disptop < 0) {
            /*
             * Inverse of the adjustment at the top of this function.
             * This time, we're swapping _to_ the alternate screen, so
             * some lines are about to _appear_ in the virtual
             * scrollback, and we adjust disptop in the other
             * direction.
             *
             * Both these adjustments depend on the value stored in
             * alt_sblines while the alt screen is selected,
             * which is why we had to do one _before_ switching away
             * from it and the other _after_ switching to it.
             */
            disptop -= alt_sblines;
            int limit = -sblines();
            if (disptop < limit)
                disptop = limit;
        }
    }

    if (reset)
        erase_lots(false, true, true);
}

/*
 * Update the scroll bar.
 */
void Terminal::update_sbar()
{
    int nscroll = sblines();
    win->set_scrollbar(nscroll + rows, nscroll + disptop, rows);
}

/*
 * Check whether the region bounded by the two pointers intersects
 * the scroll region, and de-select the on-screen selection if so.
 */
void Terminal::check_selection(pos from, pos to)
{
    if (poslt(from, selend) && poslt(selstart, to))
        deselect();
}

void Terminal::clear_line(shared_ptr<termline> line)
{
    resizeline(line, cols);
    for (int i = 0; i < cols; i++)
        copy_termchar(line, i, &erase_char);
    line->lattr = LATTR_NORM;
}

/*
 * Scroll the screen. (`lines' is +ve for scrolling forward, -ve
 * for backward.) `sb' is true if the scrolling is permitted to
 * affect the scrollback buffer.
 */
void Terminal::scroll(int topline, int botline, int lines, bool sb)
{
    int seltop;

    if (topline != 0 || alt_which != 0)
        sb = false;

    int scrollwinsize = botline - topline + 1;

    if (lines < 0) {
        lines = -lines;
        if (lines > scrollwinsize)
            lines = scrollwinsize;
        while (lines-- > 0) {
            shared_ptr<termline> line = get_and_remove_line(screen, botline);
            resizeline(line, cols);
            clear_line(line);
            insert_line(screen, line, topline);

            if (selstart.y >= topline && selstart.y <= botline) {
                selstart.y++;
                if (selstart.y > botline) {
                    selstart.y = botline + 1;
                    selstart.x = 0;
                }
            }
            if (selend.y >= topline && selend.y <= botline) {
                selend.y++;
                if (selend.y > botline) {
                    selend.y = botline + 1;
                    selend.x = 0;
                }
            }
        }
    } else {
        if (lines > scrollwinsize)
            lines = scrollwinsize;
        while (lines-- > 0) {
            shared_ptr<termline> line = get_and_remove_line(screen, topline);
#ifdef TERM_CC_DIAGS
            cc_check(line);
#endif
            if (sb && savelines > 0) {
                /*
                 * We must add this line to the scrollback. We'll
                 * remove a line from the top of the scrollback if
                 * the scrollback is full.
                 */
                if (scrollback.size() == savelines) { // XXX slow
                    get_and_remove_line(scrollback, 0);
                } else
                    tempsblines += 1;

                scrollback.push_back(line);

                /*
                 * If the user is currently looking at part of the
                 * scrollback, and they haven't enabled any options
                 * that are going to reset the scrollback as a
                 * result of this movement, then the chances are
                 * they'd like to keep looking at the same line. So
                 * we move their viewpoint at the same rate as the
                 * scroll, at least until their viewpoint hits the
                 * top end of the scrollback buffer, at which point
                 * we don't have the choice any more.
                 *
                 * Thanks to Jan Holmen Holsten for the idea and
                 * initial implementation.
                 */
                if (disptop > -savelines && disptop < 0)
                    disptop--;
            }


            line = newtermline(this, cols, false); // XXX: not sure about bce flag
            clear_line(line);
            insert_line(screen, line, botline);

            /*
             * If the selection endpoints move into the scrollback,
             * we keep them moving until they hit the top. However,
             * of course, if the line _hasn't_ moved into the
             * scrollback then we don't do this, and cut them off
             * at the top of the scroll region.
             *
             * This applies to selstart and selend (for an existing
             * selection), and also selanchor (for one being
             * selected as we speak).
             */
            seltop = sb ? -savelines : topline;

            if (selstate != NO_SELECTION) {
                if (selstart.y >= seltop && selstart.y <= botline) {
                    selstart.y--;
                    if (selstart.y < seltop) {
                        selstart.y = seltop;
                        selstart.x = 0;
                    }
                }
                if (selend.y >= seltop && selend.y <= botline) {
                    selend.y--;
                    if (selend.y < seltop) {
                        selend.y = seltop;
                        selend.x = 0;
                    }
                }
                if (selanchor.y >= seltop && selanchor.y <= botline) {
                    selanchor.y--;
                    if (selanchor.y < seltop) {
                        selanchor.y = seltop;
                        selanchor.x = 0;
                    }
                }
            }
        }
    }
}

/*
 * Move the cursor to a given position, clipping at boundaries. We
 * may or may not want to clip at the scroll margin: marg_clip is 0
 * not to, 1 to disallow _passing_ the margins, and 2 to disallow
 * even _being_ outside the margins.
 */
void Terminal::move_cursor(int x, int y, int marg_clip)
{
    if (x < 0)
        x = 0;
    if (x >= cols)
        x = cols - 1;
    if (marg_clip) {
        if ((curs.y >= marg_t || marg_clip == 2) &&
            y < marg_t)
            y = marg_t;
        if ((curs.y <= marg_b || marg_clip == 2) &&
            y > marg_b)
            y = marg_b;
    }
    if (y < 0)
        y = 0;
    if (y >= rows)
        y = rows - 1;
    curs.x = x;
    curs.y = y;
    wrapnext = false;
}

/*
 * Save or restore the cursor and SGR mode.
 */
void Terminal::save_cursor(bool save)
{
    if (save) {
        savecurs = curs;
        save_attr = curr_attr;
        save_truecolor = curr_truecolor;
        save_wnext = wrapnext;
    } else {
        curs = savecurs;
        /* Make sure the window hasn't shrunk since the save */
        if (curs.x >= cols)
            curs.x = cols - 1;
        if (curs.y >= rows)
            curs.y = rows - 1;

        curr_attr = save_attr;
        curr_truecolor = save_truecolor;
        wrapnext = save_wnext;
        /*
         * wrapnext might reset to False if the x position is no
         * longer at the rightmost edge.
         */
        if (wrapnext && curs.x < cols-1)
            wrapnext = false;
        set_erase_char();
    }
}

/*
 * This function is called before doing _anything_ which affects
 * only part of a line of text. It is used to mark the boundary
 * between two character positions, and it indicates that some sort
 * of effect is going to happen on only one side of that boundary.
 *
 * The effect of this function is to check whether a CJK
 * double-width character is straddling the boundary, and to remove
 * it and replace it with two spaces if so. (Of course, one or
 * other of those spaces is then likely to be replaced with
 * something else again, as a result of whatever happens next.)
 *
 * Also, if the boundary is at the right-hand _edge_ of the screen,
 * it implies something deliberate is being done to the rightmost
 * column position; hence we must clear LATTR_WRAPPED2.
 *
 * The input to the function is the coordinates of the _second_
 * character of the pair.
 */
void Terminal::check_boundary(int x, int y)
{
    shared_ptr<termline> ldata;

    /* Validate input coordinates, just in case. */
    if (x <= 0 || x > cols)
        return;

    ldata = scrlineptr(y);
    check_line_size(ldata);
    if (x == cols) {
        ldata->lattr &= ~LATTR_WRAPPED2;
    } else {
        if (ldata->chars[x].chr == UCSWIDE) {
            ldata->clear_combining_character(x-1);
            ldata->clear_combining_character(x);
            ldata->chars[x-1].chr = ' ';
            ldata->chars[x] = ldata->chars[x-1];
        }
    }
}

/*
 * Erase a large portion of the screen: the whole screen, or the
 * whole line, or parts thereof.
 */
void Terminal::erase_lots(bool line_only, bool from_begin, bool to_end)
{
    pos start, end;
    bool erase_lattr;
    bool erasing_lines_from_top = false;

    if (line_only) {
        start.y = curs.y;
        start.x = 0;
        end.y = curs.y + 1;
        end.x = 0;
        erase_lattr = false;
    } else {
        start.y = 0;
        start.x = 0;
        end.y = rows;
        end.x = 0;
        erase_lattr = true;
    }

    /* This is the endpoint of the clearing operation that is not
     * either the start or end of the line / screen. */
    pos boundary = curs;

    if (!from_begin) {
        /*
         * If we're erasing from the current char to the end of
         * line/screen, then we take account of wrapnext, so as to
         * maintain the invariant that writing a printing character
         * followed by ESC[K should not overwrite the character you
         * _just wrote_. That is, when wrapnext says the cursor is
         * 'logically' at the very rightmost edge of the screen
         * instead of just before the last printing char, ESC[K should
         * do nothing at all, and ESC[J should clear the next line but
         * leave this one unchanged.
         *
         * This adjusted position will also be the position we use for
         * check_boundary (i.e. the thing we ensure isn't in the
         * middle of a double-width printing char).
         */
        if (wrapnext)
            incpos(boundary);

        start = boundary;
    }
    if (!to_end) {
        /*
         * If we're erasing from the start of (at least) the line _to_
         * the current position, then that is taken to mean 'inclusive
         * of the cell under the cursor', which means we don't
         * consider wrapnext at all: whether it's set or not, we still
         * clear the cell under the cursor.
         *
         * Again, that incremented boundary position is where we
         * should be careful of a straddling wide character.
         */
        incpos(boundary);
        end = boundary;
    }
    if (!from_begin || !to_end)
        check_boundary(boundary.x, boundary.y);
    check_selection(start, end);

    /* Clear screen also forces a full window redraw, just in case. */
    if (start.y == 0 && start.x == 0 && end.y == rows)
        term_invalidate();

    /* Lines scrolled away shouldn't be brought back on if the terminal
     * resizes. */
    if (start.y == 0 && start.x == 0 && end.x == 0 && erase_lattr)
        erasing_lines_from_top = true;

    if (erasing_lines_from_top) {
        /* If it's a whole number of lines, starting at the top, and
         * we're fully erasing them, erase by scrolling and keep the
         * lines in the scrollback. */
        int scrolllines = end.y;
        if (end.y == rows) {
            /* Shrink until we find a non-empty row.*/
            scrolllines = find_last_nonempty_line(screen) + 1;
        }
        if (scrolllines > 0)
            scroll(0, scrolllines - 1, scrolllines, true);
    } else {
        shared_ptr<termline> ldata = scrlineptr(start.y);
        while (poslt(start, end)) {
            check_line_size(ldata);
            if (start.x == cols) {
                if (!erase_lattr)
                    ldata->lattr &= ~(LATTR_WRAPPED | LATTR_WRAPPED2);
                else
                    ldata->lattr = LATTR_NORM;
            } else {
                copy_termchar(ldata, start.x, &erase_char);
            }
            if (incpos(start) && start.y < rows) {
                ldata = scrlineptr(start.y);
            }
        }
    }

    /* After an erase of lines from the top of the screen, we shouldn't
     * bring the lines back again if the terminal enlarges (since the user or
     * application has explicitly thrown them away). */
    if (erasing_lines_from_top && !(alt_which))
        tempsblines = 0;
}

/*
 * Insert or delete characters within the current line. n is positive if
 * insertion is desired, and negative for deletion.
 */
void Terminal::insch(int n)
{
    int dir = (n < 0 ? -1 : +1);

    n = (n < 0 ? -n : n);
    if (n > cols - curs.x)
        n = cols - curs.x;
    int m = cols - curs.x - n;

    /*
     * We must de-highlight the selection if it overlaps any part of
     * the region affected by this operation, i.e. the region from the
     * current cursor position to end-of-line, _unless_ the entirety
     * of the selection is going to be moved to the left or right by
     * this operation but otherwise unchanged, in which case we can
     * simply move the highlight with the text.
     */
    pos eol;
    eol.y = curs.y;
    eol.x = cols;
    if (poslt(curs, selend) && poslt(selstart, eol)) {
        pos okstart = curs;
        pos okend = eol;
        if (dir > 0) {
            /* Insertion: n characters at EOL will be splatted. */
            okend.x -= n;
        } else {
            /* Deletion: n characters at cursor position will be splatted. */
            okstart.x += n;
        }
        if (posle(okstart, selstart) && posle(selend, okend)) {
            /* Selection is contained entirely in the interval
             * [okstart,okend), so we need only adjust the selection
             * bounds. */
            selstart.x += dir * n;
            selend.x += dir * n;
            assert(selstart.x >= curs.x);
            assert(selstart.x < cols);
            assert(selend.x > curs.x);
            assert(selend.x <= cols);
        } else {
            /* Selection is not wholly contained in that interval, so
             * we must unhighlight it. */
            deselect();
        }
    }

    check_boundary(curs.x, curs.y);
    if (dir < 0)
        check_boundary(curs.x + n, curs.y);

    shared_ptr<termline> ldata = scrlineptr(curs.y);
    if (dir < 0) {
        for (int j = 0; j < m; j++)
            move_termchar(ldata, curs.x + j, curs.x + j + n);
        while (n--)
            copy_termchar(ldata, curs.x + m++, &erase_char);
    } else {
        for (int j = m; j-- ;)
            move_termchar(ldata, curs.x + j + n, curs.x + j);
        while (n--)
            copy_termchar(ldata, curs.x + n, &erase_char);
    }
}

void Terminal::term_update_raw_mouse_mode()
{
    bool want_raw = xterm_mouse != 0;
    win->set_raw_mouse_mode(want_raw);
    win_pointer_shape_pending = true;
    win_pointer_shape_raw = want_raw;
    schedule_update();
}

void Terminal::term_request_resize(int cols, int rows)
{
    if (cols == cols && rows == rows)
        return;                        /* don't need to do anything */

    win_resize_pending = Terminal::WIN_RESIZE_NEED_SEND;
    win_resize_pending_w = cols;
    win_resize_pending_h = rows;
    schedule_update();
}

/*
 * Toggle terminal mode `mode' to state `state'. (`query' indicates
 * whether the mode is a DEC private one or a normal one.)
 */
void Terminal::toggle_mode(int mode, int query, bool state)
{
    if (query == 1) {
        switch (mode) {
        case 1:                      // DECCKM: application cursor keys
            app_cursor_keys = state;
            break;
        case 2:                      // DECANM: VT52 mode
            break;
        case 3:                      // DECCOLM: 80/132 columns
            deselect();
            term_request_resize(state ? 132 : 80, rows);
            reset_132 = state;
            alt_t = marg_t = 0;
            alt_b = marg_b = rows - 1;
            move_cursor(0, 0, 0);
            erase_lots(false, true, true);
            break;
        case 5:                      // DECSCNM: reverse video
            // Toggle reverse video. If we receive an OFF within the
            // visual bell timeout period after an ON, we trigger an
            // effective visual bell, so that ESC[?5hESC[?5l will
            // always be an actually _visible_ visual bell.
            if (rvideo && !state) {
                // This is an OFF, so set up a vbell
                term_schedule_vbell(true, rvbell_startpoint);
            } else if (!rvideo && state) {
                // This is an ON, so we notice the time and save it.
                rvbell_startpoint = GetTickCount();
            }
            rvideo = state;
            saw_disp_event();
            break;
        case 6:                      // DECOM: DEC origin mode
        case 7:                      // DECAWM: auto wrap
            break;
        case 8:                      // DECARM: auto key repeat
            repeat_off = !state;
            break;
        case 25:                     // DECTCEM: enable/disable cursor
            compatibility2(CL_OTHER, CL_VT220);
            cursor_on = state;
            saw_disp_event();
            break;
        case 47:                     // alternate screen
            compatibility(CL_OTHER);
            deselect();
            swap_screen(state, false, false);
            disptop = 0;
            break;
        case 1000:                   // xterm mouse 1 (normal)
            xterm_mouse = state ? 1 : 0;
            term_update_raw_mouse_mode();
            break;
        case 1002:                   // xterm mouse 2 (inc. button drags)
            xterm_mouse = state ? 2 : 0;
            term_update_raw_mouse_mode();
            break;
        case 1006:                   // xterm extended mouse
            xterm_extended_mouse = state;
            break;
        case 1015:                   // urxvt extended mouse
            urxvt_extended_mouse = state;
            break;
        case 1047:                   // alternate screen
            compatibility(CL_OTHER);
            deselect();
            swap_screen(state, true, true);
            disptop = 0;
            break;
        case 1048:                   // save/restore cursor
            save_cursor(state);
            if (!state) saw_disp_event();
            break;
        case 1049:                   // cursor & alternate screen
            if (state)
                save_cursor(state);
            if (!state) saw_disp_event();
            compatibility(CL_OTHER);
            deselect();
            swap_screen(state, true, false);
            if (!state)
                save_cursor(state);
            disptop = 0;
            break;
        }
    } else if (query == 0) {
        switch (mode) {
        case 4:                      // IRM: set insert mode
            compatibility(CL_VT102);
            insert = state;
            break;
        case 12:                     // SRM: set echo mode
            srm_echo = !state;
            break;
        case 20:                     // LNM: Return sends ...
            cr_lf_return = state;
            break;
        }
    }
}

/*
 * Process an OSC sequence: set window title or icon name.
 */
void Terminal::do_osc()
{
    if (osc_w) {
        // Removed "change wordness".
        return;
    }

    osc_string[osc_strlen] = '\0';
    switch (esc_args[0]) {
    case 0:
    case 1:
        schedule_update();
        if (esc_args[0] == 1)
            break;

    // fall through: parameter 0 means set both
    case 2:
    case 21:
        window_title = osc_string;
        win_title_pending = true;
        schedule_update();
        break;
    case 4:
        if (!strcmp(osc_string, "?")) {
            unsigned index = esc_args[1];
            if (index < OSC4_NCOLORS) {
                rgb color = palette[index];
                string reply_buf = ssprintf(
                    "\033]4;%u;rgb:%04x/%04x/%04x\007", index,
                    (unsigned)color.r * 0x0101,
                    (unsigned)color.g * 0x0101,
                    (unsigned)color.b * 0x0101);
                client->send(reply_buf.c_str(), reply_buf.size());
            }
        }
        break;
    }
}

void Terminal::term_display_graphic_char(unsigned long c)
{
    shared_ptr<termline> cline = scrlineptr(curs.y);
    int width = 0;
    if (!width)
        width = mk_wcwidth(c);

    if (wrapnext && width > 0) {
        cline->lattr |= LATTR_WRAPPED;
        if (curs.y == marg_b)
            scroll(marg_t, marg_b, 1, true);
        else if (curs.y < rows - 1)
            curs.y++;
        curs.x = 0;
        wrapnext = false;
        cline = scrlineptr(curs.y);
    }
    if (insert && width > 0)
        insch(width);
    if (selstate != NO_SELECTION) {
        pos cursplus = curs;
        incpos(cursplus);
        check_selection(curs, cursplus);
    }

    int linecols = cols;

    /*
     * Preliminary check: if the terminal is only one character cell
     * wide, then we cannot display any double-width character at all.
     * Substitute single-width REPLACEMENT CHARACTER instead.
     */
    if (width == 2 && linecols < 2) {
        width = 1;
        c = 0xFFFD;
    }

    switch (width) {
      case 2:
        /*
         * If we're about to display a double-width character starting
         * in the rightmost column, then we do something special
         * instead. We must print a space in the last column of the
         * screen, then wrap; and we also set LATTR_WRAPPED2 which
         * instructs subsequent cut-and-pasting not only to splice
         * this line to the one after it, but to ignore the space in
         * the last character position as well. (Because what was
         * actually output to the terminal was presumably just a
         * sequence of CJK characters, and we don't want a space to be
         * pasted in the middle of those just because they had the
         * misfortune to start in the wrong parity column. xterm
         * concurs.)
         */
        check_boundary(curs.x, curs.y);
        check_boundary(curs.x+2, curs.y);
        if (curs.x >= linecols-1) {
            copy_termchar(cline, curs.x, &erase_char);
            cline->lattr |= LATTR_WRAPPED | LATTR_WRAPPED2;
            if (curs.y == marg_b)
                scroll(marg_t, marg_b, 1, true);
            else if (curs.y < rows - 1)
                curs.y++;
            curs.x = 0;
            cline = scrlineptr(curs.y);
            /* Now we must check_boundary again, of course. */
            check_boundary(curs.x, curs.y);
            check_boundary(curs.x+2, curs.y);
        }

        /* FULL-TERMCHAR */
        cline->clear_combining_character(curs.x);
        cline->chars[curs.x].chr = c;
        cline->chars[curs.x].attr = curr_attr;
        cline->chars[curs.x].truecolor = curr_truecolor;

        curs.x++;

        /* FULL-TERMCHAR */
        cline->clear_combining_character(curs.x);
        cline->chars[curs.x].chr = UCSWIDE;
        cline->chars[curs.x].attr = curr_attr;
        cline->chars[curs.x].truecolor = curr_truecolor;

        break;
      case 1:
        check_boundary(curs.x, curs.y);
        check_boundary(curs.x+1, curs.y);

        /* FULL-TERMCHAR */
        cline->clear_combining_character(curs.x);
        cline->chars[curs.x].chr = c;
        cline->chars[curs.x].attr = curr_attr;
        cline->chars[curs.x].truecolor = curr_truecolor;

        break;
      case 0:
        if (curs.x > 0) {
            int x = curs.x - 1;

            /* If we're in wrapnext state, the character to combine
             * with is _here_, not to our left. */
            if (wrapnext)
                x++;

            /*
             * If the previous character is UCSWIDE, back up another
             * one.
             */
            if (cline->chars[x].chr == UCSWIDE) {
                assert(x > 0);
                x--;
            }

            cline->add_combining_character(x, c);
            saw_disp_event();
        }
        return;
      default:
        return;
    }
    curs.x++;
    if (curs.x >= linecols) {
        curs.x = linecols - 1;
        wrapnext = true;
    }
    saw_disp_event();
}

string Terminal::term_input_data_from_unicode(const wstring &widebuf)
{
    string buf;

    // Translate input wide characters into UTF-8 to go in the
    // terminal's input data queue.
    for (int i = 0; i < widebuf.size(); i++) {
        unsigned long ch = widebuf[i];

        if (IS_SURROGATE(ch)) {
            if (i+1 < widebuf.size()) {
                unsigned long ch2 = widebuf[i+1];
                if (IS_SURROGATE_PAIR(ch, ch2)) {
                    ch = FROM_SURROGATES(ch, ch2);
                    i++;
                }
            }
        }

        char utf8_chr[6];
        int len = encode_utf8(utf8_chr, ch);
        buf.append(utf8_chr, len);
    }

    return buf;
}

string Terminal::term_input_data_from_charset(int codepage, const char *str, int len)
{
    string buf;

    if (codepage < 0) {
        buf.append(str, len);
    } else {
        wstring s = codepage_to_wstring(codepage, str);
        buf = term_input_data_from_unicode(s);
    }

    return buf;
}

void Terminal::term_keyinput_internal(const char *buf, int len, bool interactive)
{
    if(srm_echo) {
        /*
         * Implement the terminal-level local echo behaviour that
         * ECMA-48 specifies when terminal mode 12 is configured off
         * (ESC[12l). In this mode, data input to the terminal via the
         * keyboard is also added to the output buffer. But this
         * doesn't apply to escape sequences generated as session
         * input _within_ the terminal, e.g. in response to terminal
         * query sequences, or the bracketing sequences of bracketed
         * paste mode. Those will be sent directly via
         * client->send() and won't go through this function.
         */

        // Mimic the special case of negative length in client->send
        int true_len = len >= 0 ? len : strlen(buf);

        inbuf.add(buf, true_len);
        term_added_data();
    }
    client->send(buf, len);
}

unsigned long Terminal::term_translate(struct term_utf8_decode *utf8, unsigned char c)
{
    switch (utf8->state) {
    case 0:
        if (c < 0x80) {
            return c;
        } else if ((c & 0xe0) == 0xc0) {
            utf8->size = utf8->state = 1;
            utf8->chr = (c & 0x1f);
        } else if ((c & 0xf0) == 0xe0) {
            utf8->size = utf8->state = 2;
            utf8->chr = (c & 0x0f);
        } else if ((c & 0xf8) == 0xf0) {
            utf8->size = utf8->state = 3;
            utf8->chr = (c & 0x07);
        } else if ((c & 0xfc) == 0xf8) {
            utf8->size = utf8->state = 4;
            utf8->chr = (c & 0x03);
        } else if ((c & 0xfe) == 0xfc) {
            utf8->size = utf8->state = 5;
            utf8->chr = (c & 0x01);
        } else {
            return UCSINVALID;
        }
        return UCSINCOMPLETE;
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
        if ((c & 0xC0) != 0x80) {
            utf8->state = 0;
            return UCSTRUNCATED;   /* caller will then give us the
                                   * same byte again */
        }
        utf8->chr = (utf8->chr << 6) | (c & 0x3f);
        if (--utf8->state)
            return UCSINCOMPLETE;

        unsigned long t = utf8->chr;

        /* Is somebody trying to be evil! */
        if (t < 0x80 ||
            (t < 0x800 && utf8->size >= 2) ||
            (t < 0x10000 && utf8->size >= 3) ||
            (t < 0x200000 && utf8->size >= 4) ||
            (t < 0x4000000 && utf8->size >= 5))
            return UCSINVALID;

        /* Unicode line separator and paragraph separator are CR-LF */
        if (t == 0x2028 || t == 0x2029)
            return 0x85;

        /* High controls are probably a Baaad idea too. */
        if (t < 0xA0)
            return 0xFFFD;

        /* The UTF-16 surrogates are not nice either. */
        /*       The standard give the option of decoding these:
        *       I don't want to! */
        if (t >= 0xD800 && t < 0xE000)
            return UCSINVALID;

        /* ISO 10646 characters now limited to UTF-16 range. */
        if (t > 0x10FFFF)
            return UCSINVALID;

        /* This is currently a TagPhobic application.. */
        if (t >= 0xE0000 && t <= 0xE007F)
            return UCSINCOMPLETE;

        /* U+FEFF is best seen as a null. */
        if (t == 0xFEFF)
            return UCSINCOMPLETE;
        /* But U+FFFE is an error. */
        if (t == 0xFFFE || t == 0xFFFF)
            return UCSINVALID;

        return t;
    }

    return c;
}

/*
 * Remove everything currently in `inbuf' and stick it up on the
 * in-memory display. There's a big state machine in here to
 * process escape sequences...
 */
void Terminal::term_out()
{
    unsigned long c;
    int unget = -1;
    const unsigned char *chars = NULL;
    size_t nchars_got = 0, nchars_used = 0;

    /*
     * During drag-selects, we do not process terminal input, because
     * the user will want the screen to hold still to be selected.
     */
    if (selstate == DRAGGING)
        return;

    while (nchars_got < nchars_used || unget != -1 || inbuf.size() > 0)
    {
        if (unget != -1) {
            // Handle a character we left in 'unget' the last time
            // round this loop. This happens if a UTF-8 sequence is
            // aborted early, by containing fewer continuation bytes
            // than its introducer expected: the non-continuation byte
            // that interrupted the sequence must now be processed
            // as a fresh piece of input in its own right.
            c = unget;
            unget = -1;
        } else {
            // If we're waiting for a terminal resize triggered by an
            // escape sequence, we defer processing the terminal
            // output until we receive acknowledgment from the front
            // end that the resize has happened, so that further
            // output will be processed in the context of the new
            // size.
            //
            // This test goes inside the main while-loop, so that we
            // exit early if we encounter a resize escape sequence
            // part way through inbuf.
            //
            // It's also in the branch of this if statement that
            // doesn't deal with a character left in 'unget' by the
            // previous loop iteration, because if we break out of
            // this loop with an ungot character still pending, we'll
            // lose it. (And in any case, if the previous thing that
            // happened was a truncated UTF-8 sequence, then it won't
            // have scheduled a pending resize.)
            if (win_resize_pending != Terminal::WIN_RESIZE_NO)
                break;

            if (nchars_got == nchars_used) {
                /* Delete the previous chunk from the bufchain */
                inbuf.consume(nchars_used);
                nchars_used = 0;

                if (inbuf.size() == 0)
                    break;             /* no more data */

                ptrlen data = inbuf.prefix();
                chars = (unsigned char *) data.ptr;
                nchars_got = data.len;
                assert(chars != NULL);
                assert(nchars_used < nchars_got);
            }
            c = chars[nchars_used++];
        }

        // Do character-set translation.
        if (termstate == Terminal::TOPLEVEL) {
            unsigned long t = term_translate(&utf8, char(c));
            switch (t) {
            case UCSINCOMPLETE:
                continue;       /* didn't complete a multibyte char */
            case UCSTRUNCATED:
                unget = c;
                /* fall through */
            case UCSINVALID:
                c = UCSERR;
                break;
            default:
                c = t;
                break;
            }
        }

        term_out_inner(c);

        if (selstate != NO_SELECTION) {
            pos cursplus = curs;
            incpos(cursplus);
            check_selection(curs, cursplus);
        }
    }

    inbuf.consume(nchars_used);
}

void Terminal::term_out_inner(unsigned long c)
{
    // How about C1 controls?
    // Explicitly ignore SCI (0x9a), which we don't translate to DECID.
    if ((c & -32) == 0x80 && termstate < Terminal::DO_CTRLS &&
        has_compat(VT220)) {
        if (c == 0x9a)
            c = 0;
        else {
            termstate = Terminal::SEEN_ESC;
            esc_query = 0;
            c = '@' + (c & 0x1F);
        }
    }

    // Or the GL control.
    if (c == '\177' && termstate < Terminal::DO_CTRLS && has_compat(OTHER)) {
        if (curs.x && !wrapnext)
            curs.x--;
        wrapnext = false;

        // destructive backspace might be disabled
        check_boundary(curs.x, curs.y);
        check_boundary(curs.x+1, curs.y);
        copy_termchar(scrlineptr(curs.y), curs.x, &erase_char);
        return;
    }

    // Or normal C0 controls.
    if ((c & ~0x1F) == 0 && termstate < Terminal::DO_CTRLS) {
        switch (c) {
        case '\007': {            /* BEL: Bell */
            if (termstate == Terminal::SEEN_OSC ||
                termstate == Terminal::SEEN_OSC_W) {
                // In an OSC context, BEL is one of the ways to terminate
                // the whole sequence. We process it as such even if we
                // haven't got into the final OSC_STRING state yet, so that
                // OSC sequences without a string will be handled cleanly.
                do_osc();
                termstate = Terminal::TOPLEVEL;
                break;
            }

            /*
            * Perform an actual beep if we're not overloaded.
            */
            term_schedule_vbell(false, 0);
            saw_disp_event();
            break;
        }
        case '\b':              /* BS: Back space */
            if (curs.x == 0 && curs.y == 0)
                /* do nothing */ ;
            else if (curs.x == 0 && curs.y > 0)
                curs.x = cols - 1, curs.y--;
            else if (wrapnext)
                wrapnext = false;
            else
                curs.x--;
            saw_disp_event();
            break;
        case '\016':            /* LS1: Locking-shift one */
            compatibility(CL_VT100);
            cset = 1;
            break;
        case '\017':            /* LS0: Locking-shift zero */
            compatibility(CL_VT100);
            cset = 0;
            break;
        case '\033':            /* ESC: Escape */
            compatibility(CL_ANSIMIN);
            termstate = Terminal::SEEN_ESC;
            esc_query = 0;
            break;
        case '\015':            /* CR: Carriage return */
            curs.x = 0;
            wrapnext = false;
            saw_disp_event();
            break;
        case '\014':            /* FF: Form feed */
            if (has_compat(SCOANSI)) {
                move_cursor(0, 0, 0);
                erase_lots(false, false, true);
                disptop = 0;
                wrapnext = false;
                saw_disp_event();
                break;
            }
        case '\013':            /* VT: Line tabulation */
            compatibility(CL_VT100);
        case '\012':            /* LF: Line feed */
            if (curs.y == marg_b)
                scroll(marg_t, marg_b, 1, true);
            else if (curs.y < rows - 1)
                curs.y++;
            wrapnext = false;
            saw_disp_event();
            break;
        case '\t': {              /* HT: Character tabulation */
            pos old_curs = curs;
            shared_ptr<termline> ldata = scrlineptr(curs.y);

            do {
                curs.x++;
            } while (curs.x < cols - 1 &&
                !tabs[curs.x]);

            if ((ldata->lattr & LATTR_MODE) != LATTR_NORM) {
                if (curs.x >= cols / 2)
                    curs.x = cols / 2 - 1;
            } else {
                if (curs.x >= cols)
                    curs.x = cols - 1;
            }

            check_selection(old_curs, curs);
            saw_disp_event();
            break;
        }
        }
        return;
    }

    switch (termstate) {
    case Terminal::TOPLEVEL:
        // Only graphic characters get this far; ctrls are stripped above
        term_display_graphic_char(c);
        last_graphic_char = c;
        break;

    case Terminal::OSC_MAYBE_ST:
        /*
        * This state is virtually identical to SEEN_ESC, with the
        * exception that we have an OSC sequence in the pipeline,
        * and _if_ we see a backslash, we process it.
        */
        if (c == '\\') {
            do_osc();
            termstate = Terminal::TOPLEVEL;
            break;
        }
        // fallthrough
    case Terminal::SEEN_ESC:
        if (c >= ' ' && c <= '/') {
            if (esc_query)
                esc_query = -1;
            else
                esc_query = c;
            break;
        }
        termstate = Terminal::TOPLEVEL;
        switch (ANSI(c, esc_query)) {
        case '[':             /* enter CSI mode */
            termstate = Terminal::SEEN_CSI;
            esc_nargs = 1;
            esc_args[0] = ARG_DEFAULT;
            esc_query = 0;
            break;
        case ']':             /* OSC: xterm escape sequences */
                              /* Compatibility is nasty here, xterm, linux, decterm yuk! */
            compatibility(CL_OTHER);
            termstate = Terminal::SEEN_OSC;
            esc_args[0] = 0;
            esc_nargs = 1;
            break;
        case '7':             /* DECSC: save cursor */
            compatibility(CL_VT100);
            save_cursor(true);
            break;
        case '8':             /* DECRC: restore cursor */
            compatibility(CL_VT100);
            save_cursor(false);
            saw_disp_event();
            break;
        case '=':             /* DECKPAM: Keypad application mode */
            compatibility(CL_VT100);
            app_keypad_keys = true;
            break;
        case '>':             /* DECKPNM: Keypad numeric mode */
            compatibility(CL_VT100);
            app_keypad_keys = false;
            break;
        case 'D':            /* IND: exactly equivalent to LF */
            compatibility(CL_VT100);
            if (curs.y == marg_b)
                scroll(marg_t, marg_b, 1, true);
            else if (curs.y < rows - 1)
                curs.y++;
            wrapnext = false;
            saw_disp_event();
            break;
        case 'E':            /* NEL: exactly equivalent to CR-LF */
            compatibility(CL_VT100);
            curs.x = 0;
            if (curs.y == marg_b)
                scroll(marg_t, marg_b, 1, true);
            else if (curs.y < rows - 1)
                curs.y++;
            wrapnext = false;
            saw_disp_event();
            break;
        case 'M':            /* RI: reverse index - backwards LF */
            compatibility(CL_VT100);
            if (curs.y == marg_t)
                scroll(marg_t, marg_b, -1, true);
            else if (curs.y > 0)
                curs.y--;
            wrapnext = false;
            saw_disp_event();
            break;
        case 'Z':            /* DECID: terminal type query */
            compatibility(CL_VT100);
            client->send(id_string, strlen(id_string));
            break;
        case 'c':            /* RIS: restore power-on settings */
            compatibility(CL_VT100);
            power_on(true);
            if (reset_132) {
                term_request_resize(80, rows);
                reset_132 = false;
            }
            disptop = 0;
            saw_disp_event();
            break;
        case 'H':            /* HTS: set a tab */
            compatibility(CL_VT100);
            tabs[curs.x] = true;
            break;

        case ANSI('8', '#'): { /* DECALN: fills screen with Es :-) */
            compatibility(CL_VT100);
            shared_ptr<termline> ldata;
            int i, j;
            pos scrtop, scrbot;

            for (i = 0; i < rows; i++) {
                ldata = scrlineptr(i);
                check_line_size(ldata);
                for (j = 0; j < cols; j++) {
                    copy_termchar(ldata, j, &basic_erase_char);
                    ldata->chars[j].chr = 'E';
                }
                ldata->lattr = LATTR_NORM;
            }
            disptop = 0;
            saw_disp_event();
            scrtop.x = scrtop.y = 0;
            scrbot.x = 0;
            scrbot.y = rows;
            check_selection(scrtop, scrbot);
            break;
        }

        case ANSI('3', '#'):
        case ANSI('4', '#'):
        case ANSI('5', '#'):
        case ANSI('6', '#'): {
            compatibility(CL_VT100);
            int nlattr;
            shared_ptr<termline> ldata;

            switch (ANSI(c, esc_query)) {
            case ANSI('3', '#'): /* DECDHL: 2*height, top */
                nlattr = LATTR_TOP;
                break;
            case ANSI('4', '#'): /* DECDHL: 2*height, bottom */
                nlattr = LATTR_BOT;
                break;
            case ANSI('5', '#'): /* DECSWL: normal */
                nlattr = LATTR_NORM;
                break;
            default: /* case ANSI('6', '#'): DECDWL: 2*width */
                nlattr = LATTR_WIDE;
                break;
            }
            ldata = scrlineptr(curs.y);
            check_line_size(ldata);
            ldata->lattr = nlattr;
            break;
        }
        // GZD4: G0 designate 94-set (removed, we're in the wrong century for this)
        case ANSI('A', '('):
        case ANSI('B', '('):
        case ANSI('0', '('):
        case ANSI('A', ')'):
        case ANSI('B', ')'):
        case ANSI('0', ')'):
        case ANSI('U', ')'):
            compatibility(CL_VT100);
            break;
        case ANSI('U', '('):
            compatibility(CL_OTHER);
            break;
            /* DOCS: Designate other coding system */
        case ANSI('8', '%'):  /* Old Linux code */
        case ANSI('G', '%'):
            compatibility(CL_OTHER);
            break;
        case ANSI('@', '%'):
            compatibility(CL_OTHER);
            break;
        }
        break;
    case Terminal::SEEN_CSI:
        termstate = Terminal::TOPLEVEL;  /* default */
        if (isdigit(c)) {
            if (esc_nargs <= ARGS_MAX) {
                if (esc_args[esc_nargs - 1] == ARG_DEFAULT)
                    esc_args[esc_nargs - 1] = 0;
                if (esc_args[esc_nargs - 1] <= UINT_MAX / 10 &&
                    esc_args[esc_nargs - 1] * 10 <= UINT_MAX - c - '0')
                    esc_args[esc_nargs - 1] = 10 * esc_args[esc_nargs - 1] + c - '0';
                else
                    esc_args[esc_nargs - 1] = UINT_MAX;
            }
            termstate = Terminal::SEEN_CSI;
        } else if (c == ';') {
            if (esc_nargs < ARGS_MAX)
                esc_args[esc_nargs++] = ARG_DEFAULT;
            termstate = Terminal::SEEN_CSI;
        } else if (c < '@') {
            if (esc_query)
                esc_query = -1;
            else if (c == '?')
                esc_query = 1;
            else
                esc_query = c;
            termstate = Terminal::SEEN_CSI;
        } else switch (ANSI(c, esc_query)) {
#define CLAMP(arg, lim) ((arg) = ((arg) > (lim)) ? (lim) : (arg))
        case 'A':       // CUU: move up N lines
            CLAMP(esc_args[0], rows);
            move_cursor(curs.x, curs.y - def(esc_args[0], 1), 1);
            saw_disp_event();
            break;
        case 'e':         /* VPR: move down N lines */
            compatibility(CL_ANSI);
            /* FALLTHROUGH */
        case 'B':         /* CUD: Cursor down */
            CLAMP(esc_args[0], rows);
            move_cursor(curs.x, curs.y + def(esc_args[0], 1), 1);
            saw_disp_event();
            break;
        case 'b':        /* REP: repeat previous grap */
            CLAMP(esc_args[0], rows * cols);
            if (last_graphic_char) {
                unsigned i;
                for (i = 0; i < esc_args[0]; i++)
                    term_display_graphic_char(last_graphic_char);
            }
            break;
        case ANSI('c', '>'):      /* DA: report xterm version */
            compatibility(CL_OTHER);
            // this reports xterm version 136 so that VIM can use the drag messages from the mouse reporting
            client->send("\033[>0;136;0c", 11);
            break;
        case 'a':         /* HPR: move right N cols */
            compatibility(CL_ANSI);
            // fallthrough
        case 'C':         /* CUF: Cursor right */
            CLAMP(esc_args[0], cols);
            move_cursor(curs.x + def(esc_args[0], 1), curs.y, 1);
            saw_disp_event();
            break;
        case 'D':       /* CUB: move left N cols */
            CLAMP(esc_args[0], cols);
            move_cursor(curs.x - def(esc_args[0], 1), curs.y, 1);
            saw_disp_event();
            break;
        case 'E':       /* CNL: move down N lines and CR */
            compatibility(CL_ANSI);
            CLAMP(esc_args[0], rows);
            move_cursor(0, curs.y + def(esc_args[0], 1), 1);
            saw_disp_event();
            break;
        case 'F':       /* CPL: move up N lines and CR */
            compatibility(CL_ANSI);
            CLAMP(esc_args[0], rows);
            move_cursor(0, curs.y - def(esc_args[0], 1), 1);
            saw_disp_event();
            break;
        case 'G':       /* CHA */
        case '`':       /* HPA: set horizontal posn */
            compatibility(CL_ANSI);
            CLAMP(esc_args[0], cols);
            move_cursor(def(esc_args[0], 1) - 1, curs.y, 0);
            saw_disp_event();
            break;
        case 'd':       /* VPA: set vertical posn */
            compatibility(CL_ANSI);
            CLAMP(esc_args[0], rows);
            move_cursor(curs.x, (def(esc_args[0], 1) - 1), 0);
            saw_disp_event();
            break;
        case 'H':      /* CUP */
        case 'f':      /* HVP: set horz and vert posns at once */
            if (esc_nargs < 2)
                esc_args[1] = ARG_DEFAULT;
            CLAMP(esc_args[0], rows);
            CLAMP(esc_args[1], cols);
            move_cursor(def(esc_args[1], 1) - 1, (def(esc_args[0], 1) - 1), 0);
            saw_disp_event();
            break;
        case 'J': {       /* ED: erase screen or parts of it */
            unsigned int i = def(esc_args[0], 0);
            if (i == 3) {
                /* Erase Saved Lines (xterm)
                * This follows Thomas Dickey's xterm. */
                term_clrsb();
            } else {
                i++;
                if (i > 3)
                    i = 0;
                erase_lots(false, !!(i & 2), !!(i & 1));
            }
            disptop = 0;
            saw_disp_event();
            break;
        }
        case 'K': {       /* EL: erase line or parts of it */
            unsigned int i = def(esc_args[0], 0) + 1;
            if (i > 3)
                i = 0;
            erase_lots(true, !!(i & 2), !!(i & 1));
            saw_disp_event();
            break;
        }
        case 'L':       /* IL: insert lines */
            compatibility(CL_VT102);
            CLAMP(esc_args[0], rows);
            if (curs.y <= marg_b)
                scroll(curs.y, marg_b, -int(def(esc_args[0], 1)), false);
            saw_disp_event();
            break;
        case 'M':       /* DL: delete lines */
            compatibility(CL_VT102);
            CLAMP(esc_args[0], rows);
            if (curs.y <= marg_b)
                scroll(curs.y, marg_b, def(esc_args[0], 1), true);
            saw_disp_event();
            break;
        case '@':       /* ICH: insert chars */
                        // XXX VTTEST says this is vt220, vt510 manual says vt102
            compatibility(CL_VT102);
            CLAMP(esc_args[0], cols);
            insch(def(esc_args[0], 1));
            saw_disp_event();
            break;
        case 'P':       /* DCH: delete chars */
            compatibility(CL_VT102);
            CLAMP(esc_args[0], cols);
            insch(-int(def(esc_args[0], 1)));
            saw_disp_event();
            break;
        case 'c':       /* DA: terminal type query */
            compatibility(CL_VT100);
            /* This is the response for a VT102 */
            client->send(id_string, strlen(id_string));
            break;
        case 'n':       /* DSR: cursor position query */
            if (esc_args[0] == 6) {
                char buf[32];
                sprintf(buf, "\033[%d;%dR", curs.y + 1,
                    curs.x + 1);
                client->send( buf, strlen(buf));
            } else if (esc_args[0] == 5) {
                client->send("\033[0n", 4);
            }
            break;
        case 'h':       /* SM: toggle modes to high */
        case ANSI_QUE('h'):
            compatibility(CL_VT100);
            for (int i = 0; i < esc_nargs; i++)
                toggle_mode(esc_args[i], esc_query, true);
            break;
        case 'i':         /* MC: Media copy */
        case ANSI_QUE('i'): {
            compatibility(CL_VT100);
            break;
        }
        case 'l':       /* RM: toggle modes to low */
        case ANSI_QUE('l'):
            compatibility(CL_VT100);
            for (int i = 0; i < esc_nargs; i++)
                toggle_mode(esc_args[i], esc_query, false);
            break;
        case 'g':       /* TBC: clear tabs */
            compatibility(CL_VT100);
            if (esc_nargs == 1) {
                if (esc_args[0] == 0) {
                    tabs[curs.x] = false;
                } else if (esc_args[0] == 3) {
                    int i;
                    for (i = 0; i < cols; i++)
                        tabs[i] = false;
                }
            }
            break;
        case 'r':       /* DECSTBM: set scroll margins */
            compatibility(CL_VT100);
            if (esc_nargs <= 2) {
                int top, bot;
                CLAMP(esc_args[0], rows);
                CLAMP(esc_args[1], rows);
                top = def(esc_args[0], 1) - 1;
                bot = (esc_nargs <= 1 || esc_args[1] == 0 ? rows : def(esc_args[1], rows)) - 1;
                if (bot >= rows)
                    bot = rows - 1;
                // VTTEST Bug 9 - if region is less than 2 lines don't change region.
                if (bot - top > 0) {
                    marg_t = top;
                    marg_b = bot;
                    curs.x = 0;
                    curs.y = 0;
                    saw_disp_event();
                }
            }
            break;
        case 'm':       /* SGR: set graphics rendition */
            // A VT100 without the AVO only had one attribute, either underline or reverse
            // video depending on the cursor type, this was selected by CSI 7m.
            //
            // case 2:
            //  This is sometimes DIM, eg on the GIGI and Linux
            // case 8:
            //  This is sometimes INVIS various ANSI.
            // case 21:
            //  This like 22 disables BOLD, DIM and INVIS
            //
            // The ANSI colors appear on any terminal that has color (obviously) but the
            // interaction between sgr0 and the colors varies but is usually related to the
            // background color erase item. The interaction between color attributes and
            // the mono ones is also very implementation dependent.
            //
            // The 39 and 49 attributes are likely to be unimplemented.
            for (int i = 0; i < esc_nargs; i++)
            {
                switch (def(esc_args[i], 0)) {
                case 0:       /* restore defaults */
                    curr_attr = default_attr;
                    curr_truecolor = basic_erase_char.truecolor;
                    break;
                case 1:       /* enable bold */
                    compatibility(CL_VT100AVO);
                    curr_attr |= ATTR_BOLD;
                    break;
                case 2:       /* enable dim */
                    compatibility(CL_OTHER);
                    curr_attr |= ATTR_DIM;
                    break;
                case 21:      /* (enable double underline) */
                    compatibility(CL_OTHER);
                case 4:       /* enable underline */
                    compatibility(CL_VT100AVO);
                    curr_attr |= ATTR_UNDER;
                    break;
                case 5:       /* enable blink */
                    compatibility(CL_VT100AVO);
                    curr_attr |= ATTR_BLINK;
                    break;
                case 6:       /* SCO light bkgrd */
                    compatibility(CL_SCOANSI);
                    curr_attr |= ATTR_BLINK;
                    break;
                case 7:       /* enable reverse video */
                    curr_attr |= ATTR_REVERSE;
                    break;
                case 9:       /* enable strikethrough */
                    curr_attr |= ATTR_STRIKE;
                    break;
                case 10:      /* SCO acs (removed) */
                case 11:      /* SCO acs on */
                case 12:      /* SCO acs on, |0x80 */
                    compatibility(CL_SCOANSI);
                    break;
                case 22:      /* disable bold and dim */
                    compatibility2(CL_OTHER, CL_VT220);
                    curr_attr &= ~(ATTR_BOLD | ATTR_DIM);
                    break;
                case 24:      /* disable underline */
                    compatibility2(CL_OTHER, CL_VT220);
                    curr_attr &= ~ATTR_UNDER;
                    break;
                case 25:      /* disable blink */
                    compatibility2(CL_OTHER, CL_VT220);
                    curr_attr &= ~ATTR_BLINK;
                    break;
                case 27:      /* disable reverse video */
                    compatibility2(CL_OTHER, CL_VT220);
                    curr_attr &= ~ATTR_REVERSE;
                    break;
                case 29:      /* disable strikethrough */
                    curr_attr &= ~ATTR_STRIKE;
                    break;
                case 30:
                case 31:
                case 32:
                case 33:
                case 34:
                case 35:
                case 36:
                case 37:
                    /* foreground */
                    curr_truecolor.fg.enabled = false;
                    curr_attr &= ~ATTR_FGMASK;
                    curr_attr |= (esc_args[i] - 30)<<ATTR_FGSHIFT;
                            break;
                case 90:
                case 91:
                case 92:
                case 93:
                case 94:
                case 95:
                case 96:
                case 97:
                    /* aixterm-style bright foreground */
                    curr_truecolor.fg.enabled = false;
                    curr_attr &= ~ATTR_FGMASK;
                    curr_attr |= ((esc_args[i] - 90 + 8) << ATTR_FGSHIFT);
                    break;
                case 39:      /* default-foreground */
                    curr_truecolor.fg.enabled = false;
                    curr_attr &= ~ATTR_FGMASK;
                    curr_attr |= ATTR_DEFFG;
                    break;
                case 40:
                case 41:
                case 42:
                case 43:
                case 44:
                case 45:
                case 46:
                case 47:
                    /* background */
                    curr_truecolor.bg.enabled = false;
                    curr_attr &= ~ATTR_BGMASK;
                    curr_attr |= (esc_args[i] - 40)<<ATTR_BGSHIFT;
                    break;
                case 100:
                case 101:
                case 102:
                case 103:
                case 104:
                case 105:
                case 106:
                case 107:
                    /* aixterm-style bright background */
                    curr_truecolor.bg.enabled = false;
                    curr_attr &= ~ATTR_BGMASK;
                    curr_attr |= ((esc_args[i] - 100 + 8)
                        << ATTR_BGSHIFT);
                    break;
                case 49:      /* default-background */
                    curr_truecolor.bg.enabled = false;
                    curr_attr &= ~ATTR_BGMASK;
                    curr_attr |= ATTR_DEFBG;
                    break;

                    /*
                    * 256-color and true-color sequences. A 256-color foreground is selected by a
                    * sequence of 3 arguments in the form 38;5;n, where n is in the range 0-255. A
                    * true-color RGB triple is selected by 5 args of the form 38;2;r;g;b. Replacing
                    * the initial 38 with 48 in both cases selects the same color as the background.
                    */
                case 38:
                    if (i+2 < esc_nargs &&
                        esc_args[i+1] == 5) {
                        curr_attr &= ~ATTR_FGMASK;
                        curr_attr |= ((esc_args[i+2] & 0xFF) << ATTR_FGSHIFT);
                        curr_truecolor.fg = optionalrgb_none;
                        i += 2;
                    }
                    if (i + 4 < esc_nargs &&
                        esc_args[i + 1] == 2) {
                        parse_optionalrgb(&curr_truecolor.fg, esc_args + (i+2));
                        i += 4;
                    }
                    break;
                case 48:
                    if (i+2 < esc_nargs &&
                        esc_args[i+1] == 5) {
                        curr_attr &= ~ATTR_BGMASK;
                        curr_attr |= ((esc_args[i+2] & 0xFF) << ATTR_BGSHIFT);
                        curr_truecolor.bg = optionalrgb_none;
                        i += 2;
                    }
                    if (i + 4 < esc_nargs && esc_args[i+1] == 2) {
                        parse_optionalrgb(&curr_truecolor.bg, esc_args + (i+2));
                        i += 4;
                    }
                    break;
                }
            }
            set_erase_char();
            break;
        case 's':       /* save cursor */
                        save_cursor(true);
                        break;
        case 'u':       /* restore cursor */
            save_cursor(false);
            saw_disp_event();
            break;
        case 't': /* DECSLPP: set page size - ie window height */
            // VT340/VT420 sequence DECSLPP, DEC only allows values
            //  24/25/36/48/72/144 other emulators (eg dtterm) use
            // illegal values (eg first arg 1..9) for window changing
            // and reports.
            if (esc_nargs <= 1 && (esc_args[0] < 1 || esc_args[0] >= 24)) {
                compatibility(CL_VT340TEXT);
                term_request_resize(cols, 24);
                deselect();
            } else if (esc_nargs >= 1 &&
                esc_args[0] >= 1 &&
                esc_args[0] < 24) {
                compatibility(CL_OTHER);

                int len;
                char buf[80];
                const char *p;
                switch (esc_args[0]) {
                case 1:
                case 2:
                    // Minimize and maximize the window (removed)
                    break;
                case 3:
                    if (esc_nargs >= 3) {
                        win_move_pending = true;
                        win_move_pending_x = def(esc_args[1], 0);
                        win_move_pending_y = def(esc_args[2], 0);
                        schedule_update();
                    }
                    break;
                case 4:
                    // Resize to pixels (useless)
                    break;
                case 5:
                case 6:
                    // Removed support for moving the window to the top (Windows doesn't even
                    // allow that), and for moving to the bottom.
                    break;
                case 7:
                    win_refresh_pending = true;
                    schedule_update();
                    break;
                case 8:
                    if (esc_nargs >= 3) {
                        term_request_resize(
                            def(esc_args[2], conf->width),
                            def(esc_args[1], conf->height));
                    }
                    break;
                case 9:
                    // Maximize/unmaximize (removed)
                    break;
                case 11:
                    client->send(minimized? "\033[2t" : "\033[1t", 4);
                    break;
                case 13:
                case 14:
                    // Removed handling for things like querying the window size and position in
                    // pixels.  I can't think of any reason a terminal client would need to know
                    // the physical dimensions of the terminal.
                    break;
                case 18:
                    len = sprintf(buf, "\033[8;%d;%dt", rows, cols);
                    client->send(buf, len);
                    break;
                case 19:
                    /*
                    * Hmmm. Strictly speaking we should return `the size of the screen in characters, but
                    * that's not easy: (a) window furniture being what it is it's hard to compute, and (b)
                    * in resize-font mode maximizing the window wouldn't change the number of characters.
                    * *shrug*. I think we'll ignore it for the moment and see if anyone complains, and then
                    * ask them what they would like it to do.
                    */
                    break;
                case 20: // set icon title: ignored (not used on Windows)
                    break;
                case 21:
                    p = window_title.c_str();
                    len = strlen(p);
                    client->send("\033]l", 3);
                    client->send(p, len);
                    client->send("\033\\", 2);
                    break;
                }
            }
            break;
        case 'S':         /* SU: Scroll up */
            CLAMP(esc_args[0], rows);
            compatibility(CL_SCOANSI);
            scroll(marg_t, marg_b, def(esc_args[0], 1), true);
            wrapnext = false;
            saw_disp_event();
            break;
        case 'T':         /* SD: Scroll down */
            CLAMP(esc_args[0], rows);
            compatibility(CL_SCOANSI);
            scroll(marg_t, marg_b, -int(def(esc_args[0], 1)), true);
            wrapnext = false;
            saw_disp_event();
            break;
        case ANSI('|', '*'): /* DECSNLS */
                             // Set number of lines on screen
                             // VT420 uses VGA like hardware and can
                             // support any size in reasonable range
                             // (24..49 AIUI) with no default specified.
            compatibility(CL_VT420);
            if (esc_nargs == 1 && esc_args[0] > 0) {
                term_request_resize(cols, def(esc_args[0], conf->height));
                deselect();
            }
            break;
        case ANSI('|', '$'): /* DECSCPP */
                             // Set number of columns per page
                             // Docs imply range is only 80 or 132, but
                             // I'll allow any.
            compatibility(CL_VT340TEXT);
            if (esc_nargs <= 1) {
                term_request_resize(def(esc_args[0], conf->width), rows);
                deselect();
            }
            break;
        case 'X': {   /* ECH: write N spaces w/o moving cursor */
                      // XXX VTTEST says this is vt220, vt510 manual says vt100
            compatibility(CL_ANSIMIN);
            CLAMP(esc_args[0], cols);
            int n = def(esc_args[0], 1);
            pos cursplus;
            int p = curs.x;
            shared_ptr<termline> cline = scrlineptr(curs.y);

            if (n > cols - curs.x)
                n = cols - curs.x;
            cursplus = curs;
            cursplus.x += n;
            check_boundary(curs.x, curs.y);
            check_boundary(curs.x+n, curs.y);
            check_selection(curs, cursplus);
            while (n--)
                copy_termchar(cline, p++, &erase_char);
            saw_disp_event();
            break;
        }
        case 'x':       /* DECREQTPARM: report terminal characteristics */
            compatibility(CL_VT100);
            {
                char buf[32];
                int i = def(esc_args[0], 0);
                if (i == 0 || i == 1) {
                    strcpy(buf, "\033[2;1;1;112;112;1;0x");
                    buf[2] += i;
                    client->send(buf, 20);
                }
            }
            break;
        case 'Z': {         /* CBT */
                        compatibility(CL_OTHER);
                        CLAMP(esc_args[0], cols);
                        int i = def(esc_args[0], 1);
                        pos old_curs = curs;

                        for(;i>0 && curs.x>0; i--) {
                            do {
                                curs.x--;
                            } while (curs.x >0 && !tabs[curs.x]);
                        }
                        check_selection(old_curs, curs);
                        break;
        }
        case ANSI('c', '='):      /* Hide or Show Cursor */
            compatibility(CL_SCOANSI);
            switch(esc_args[0]) {
            case 0:  /* hide cursor */
                cursor_on = false;
                break;
            case 1:  /* restore cursor */
                cursor_on = true;
                break;
            case 2:  /* block cursor */
                cursor_on = true;
                break;
            }
            break;
        case ANSI('C', '='):
            // set cursor start on scanline esc_args[0] and
            // end on scanline esc_args[1].If you set
            // the bottom scan line to a value less than
            // the top scan line, the cursor will disappear.
            compatibility(CL_SCOANSI);
            if (esc_nargs >= 2) {
                if (esc_args[0] > esc_args[1])
                    cursor_on = false;
                else
                    cursor_on = true;
            }
            break;
        case ANSI('D', '='):
            compatibility(CL_SCOANSI);
            if (esc_args[0]>=1)
                curr_attr |= ATTR_BLINK;
            else
                curr_attr &= ~ATTR_BLINK;
            break;
        case ANSI('E', '='):
            compatibility(CL_SCOANSI);
            break;
        case ANSI('F', '='):      /* set normal foreground */
            compatibility(CL_SCOANSI);
            if (esc_args[0] < 16) {
                long color = (sco2ansicolor[esc_args[0] & 0x7] | (esc_args[0] & 0x8)) << ATTR_FGSHIFT;
                curr_attr &= ~ATTR_FGMASK;
                curr_attr |= color;
                curr_truecolor.fg = optionalrgb_none;
                default_attr &= ~ATTR_FGMASK;
                default_attr |= color;
                set_erase_char();
            }
            break;
        case ANSI('G', '='):      /* set normal background */
            compatibility(CL_SCOANSI);
            if (esc_args[0] < 16) {
                long color =
                    (sco2ansicolor[esc_args[0] & 0x7] |
                        (esc_args[0] & 0x8)) <<
                    ATTR_BGSHIFT;
                curr_attr &= ~ATTR_BGMASK;
                curr_attr |= color;
                curr_truecolor.bg = optionalrgb_none;
                default_attr &= ~ATTR_BGMASK;
                default_attr |= color;
                set_erase_char();
            }
            break;
        case ANSI('L', '='):
            compatibility(CL_SCOANSI);
            use_bce = (esc_args[0] <= 0);
            set_erase_char();
            break;
        case ANSI('p', '"'): /* DECSCL: set compat level (removed) */
            break;
        }
        break;
    case Terminal::SEEN_OSC:
        osc_w = false;
        switch (c) {
        case 'W':            /* word-set */
            termstate = Terminal::SEEN_OSC_W;
            osc_w = true;
            break;
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            if (esc_args[esc_nargs-1] <= UINT_MAX / 10 &&
                esc_args[esc_nargs-1] * 10 <= UINT_MAX - c - '0')
                esc_args[esc_nargs-1] = 10 * esc_args[esc_nargs-1] + c - '0';
            else
                esc_args[esc_nargs-1] = UINT_MAX;
            break;
        default:
            /*
            * _Most_ other characters here terminate the
            * immediate parsing of the OSC sequence and go
            * into OSC_STRING state, but we deal with a
            * couple of exceptions first.
            */
            if (c == 'L' && esc_args[0] == 2) {
                /*
                * Grotty hack to support xterm and DECterm title
                * sequences concurrently.
                */
                esc_args[0] = 1;
            } else if (c == ';' && esc_nargs == 1 && esc_args[0] == 4) {
                /*
                * xterm's OSC 4 sequence to query the current RGB value of a color takes a second
                * numeric argument which is easiest to parse using the existing system rather than in
                * do_osc.
                */
                esc_args[esc_nargs++] = 0;
            } else {
                termstate = Terminal::OSC_STRING;
                osc_strlen = 0;
            }
        }
        break;
    case Terminal::OSC_STRING:
        // OSC sequences can be terminated or aborted in various ways.
        //
        // The official way to terminate an OSC, per written standards, is the
        // String Terminator, SC. That can appear in a 7-bit two-character form
        // ESC \, or as an 8-bit C1 control 0x9C.
        //
        // We only accept 0x9C in circumstances where it doesn't interfere with
        // our main character set processing: so in ISO 8859-1, for example, the
        // byte 0x9C is interpreted as ST, but in CP437 it's interpreted as an
        // ordinary printing character (as it happens, the pound sign), because
        // you might perfectly well want to put it in the window title like any
        // other printing character.
        //
        // In particular, in UTF-8 mode, 0x9C is a perfectly valid continuation
        // byte for an ordinary printing character, so we don't accept the C1
        // control form of ST unless it appears as a full UTF-8 character in its
        // own right, i.e. bytes 0xC2 0x9C.
        //
        // BEL is also treated as a clean termination of OSC, which I believe was
        // a behaviour introduced by xterm.
        //
        // To prevent run-on storage of OSC data forever if emission of a control
        // sequence is interrupted, we also treat various control characters as illegal,
        // so that they abort the OSC without processing it and return to TOPLEVEL
        // state. These are CR, LF, and any ESC that is *not* followed by \.
        if (c == '\012' || c == '\015') {
            /* CR or LF aborts */
            termstate = Terminal::TOPLEVEL;
            break;
        }

        if (c == '\033') {
            // ESC goes into a state where we wait to see if the next character is
            termstate = Terminal::OSC_MAYBE_ST;
            break;
        }

        if (c == '\007') {
            /* BEL, or the C1 ST appearing as a one-byte
            * encoding, cleanly terminates the OSC right here */
            do_osc();
            termstate = Terminal::TOPLEVEL;
            break;
        }

        if (c == 0xC2) {
            /* 0xC2 is the UTF-8 character that might
            * introduce the encoding of C1 ST */
            termstate = Terminal::OSC_MAYBE_ST_UTF8;
            break;
        }

        /* Anything else gets added to the string */
        if (osc_strlen < OSC_STR_MAX)
            osc_string[osc_strlen++] = (char)c;
        break;
    case Terminal::OSC_MAYBE_ST_UTF8:
        // In UTF-8 mode, we've seen C2, so are we now seeing 9C?
        if (c == 0x9C) {
            /* Yes, so cleanly terminate the OSC */
            do_osc();
            termstate = Terminal::TOPLEVEL;
            break;
        }
        /* No, so append the pending C2 byte to the OSC string
        * followed by the current character, and go back to
        * OSC string accumulation */
        if (osc_strlen < OSC_STR_MAX)
            osc_string[osc_strlen++] = char(0xC2);
        if (osc_strlen < OSC_STR_MAX)
            osc_string[osc_strlen++] = (char)c;
        termstate = Terminal::OSC_STRING;
        break;
    case Terminal::SEEN_OSC_W:
        switch (c) {
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            if (esc_args[0] <= UINT_MAX / 10 &&
                esc_args[0] * 10 <= UINT_MAX - c - '0')
                esc_args[0] = 10 * esc_args[0] + c - '0';
            else
                esc_args[0] = UINT_MAX;
            break;
        default:
            termstate = Terminal::OSC_STRING;
            osc_strlen = 0;
        }
        break;

    default:
        break;
    }
}

/* Wrapper on term_out with the right prototype to be a toplevel callback */
void Terminal::term_out_hook(void *ctx)
{
    Terminal *pSelf = (Terminal *)ctx;
    pSelf->term_out();
}

/*
 * Small subroutine to parse three consecutive escape-sequence
 * arguments representing a true-color RGB triple into an
 * optionalrgb.
 */
static void parse_optionalrgb(optionalrgb *out, unsigned *values)
{
    out->enabled = true;
    out->r = values[0] < 256 ? values[0] : 0;
    out->g = values[1] < 256 ? values[1] : 0;
    out->b = values[2] < 256 ? values[2] : 0;
}

void Terminal::do_paint_draw(shared_ptr<termline> ldata, int x, int y,
                          wchar_t *ch, int ccount,
                          unsigned long attr, truecolor tc)
{
    win->draw_text(x, y, ch, ccount, attr, ldata->lattr, tc);
    if(attr & (TATTR_ACTCURS | TATTR_PASCURS))
        win->draw_cursor(x, y, ch, ccount, attr, ldata->lattr, tc);
}

/*
 * Given a context, update the window.
 */
void Terminal::do_paint()
{
    int i, j, our_curs_y, our_curs_x;
    int rv, cursor;
    pos scrpos;

    wstring ch;

    vector<termchar> newline(cols);

    rv = (!rvideo ^ !in_vbell ? ATTR_REVERSE : 0);

    /* Depends on:
     * screen array, disptop, scrtop,
     * selection, rv,
     * blinkpc,
     * curs.y, curs.x, cursor_on, has_focus, wrapnext
     */

    /* Has the cursor position or type changed ? */
    if (cursor_on) {
        cursor = has_focus? TATTR_ACTCURS:TATTR_PASCURS;
        if (wrapnext)
            cursor |= TATTR_RIGHTCURS;
    } else
        cursor = 0;

    our_curs_y = curs.y - disptop;

    {
        /*
         * Adjust the cursor position:
         *  - for bidi
         *  - in the case where it's resting on the right-hand half
         *    of a CJK wide character. xterm's behaviour here,
         *    which seems adequate to me, is to display the cursor
         *    covering the _whole_ character, exactly as if it were
         *    one space to the left.
         */
        shared_ptr<termline> ldata = lineptr(curs.y);
        our_curs_x = curs.x;

        if (our_curs_x > 0 && ldata->chars[our_curs_x].chr == UCSWIDE)
            our_curs_x--;
    }

    /*
     * If the cursor is not where it was last time we painted, and
     * its previous position is visible on screen, invalidate its
     * previous position.
     */
    if (dispcursy >= 0 &&
        (curstype != cursor || dispcursy != our_curs_y ||
         dispcursx != our_curs_x)) {
        termchar *dispcurs = &disptext[dispcursy]->chars[dispcursx];

        if (dispcursx > 0 && dispcurs->chr == UCSWIDE)
            dispcurs[-1].attr |= ATTR_INVALID;
        if (dispcursx < cols-1 && dispcurs[1].chr == UCSWIDE)
            dispcurs[1].attr |= ATTR_INVALID;
        dispcurs->attr |= ATTR_INVALID;

        curstype = 0;
    }
    dispcursx = dispcursy = -1;

    /* The normal screen data */
    for (i = 0; i < rows; i++) {
        shared_ptr<termline> ldata;
        unsigned long attr = 0;
        int start = 0;
        bool last_run_dirty = false;
        truecolor tc;

        scrpos.y = i + disptop;
        ldata = lineptr(scrpos.y);

        /* Do Arabic shaping and bidi. */
        vector<termchar> &lchars = ldata->chars;
        int *backward = NULL;

        /*
         * First loop: work along the line deciding what we want
         * each character cell to look like.
         */
        for (j = 0; j < cols; j++) {
            termchar *d = &lchars[j];
            scrpos.x = backward ? backward[j] : j;

            unsigned long tchar = d->chr;
            unsigned long tattr = d->attr;
            tc = d->truecolor;

            if (j < cols-1 && d[1].chr == UCSWIDE)
                tattr |= ATTR_WIDE;

            // Invert for vbell:
            tattr ^= rv;

            // Video reversing things
            bool selected = false;
            if (selstate == DRAGGING || selstate == SELECTED) {
                if (seltype == LEXICOGRAPHIC)
                    selected = (posle(selstart, scrpos) && poslt(scrpos, selend));
                else
                    selected = (posPle(selstart, scrpos) && posPle_left(scrpos, selend));
            }

            if(selected)
                tattr ^= ATTR_REVERSE;

            // Check the font we'll _probably_ be using to see if
            // the character is wide when we don't want it to be.
            if (tchar != disptext[i]->chars[j].chr ||
                tattr != (disptext[i]->chars[j].attr & ~(ATTR_NARROW | DATTR_MASK))) {
                if ((tattr & ATTR_WIDE) == 0 &&
                    win->get_char_width(tchar) == 2)
                    tattr |= ATTR_NARROW;
            } else if (disptext[i]->chars[j].attr & ATTR_NARROW)
                tattr |= ATTR_NARROW;

            if (i == our_curs_y && j == our_curs_x) {
                tattr |= cursor;
                curstype = cursor;
                dispcursx = j;
                dispcursy = i;
            }

            // FULL-TERMCHAR
            newline[j].attr = tattr;
            newline[j].chr = tchar;
            newline[j].truecolor = tc;
            // Combining characters are still read from lchars
            newline[j].cc_next = 0;
        }

        /*
         * Now loop over the line again, noting where things have
         * changed.
         *
         * During this loop, we keep track of where we last saw
         * DATTR_STARTRUN. Any mismatch automatically invalidates
         * _all_ of the containing run that was last printed: that
         * is, any rectangle that was drawn in one go in the
         * previous update should be either left completely alone
         * or overwritten in its entirety. This, along with the
         * expectation that front ends clip all text runs to their
         * bounding rectangle, should solve any possible problems
         * with fonts that overflow their character cells.
         */
        int laststart = 0;
        bool dirtyrect = false;
        for (j = 0; j < cols; j++) {
            if (disptext[i]->chars[j].attr & DATTR_STARTRUN) {
                laststart = j;
                dirtyrect = false;
            }

            if (disptext[i]->chars[j].chr != newline[j].chr ||
                (disptext[i]->chars[j].attr &~ DATTR_MASK)
                != newline[j].attr) {
                int k;

                if (!dirtyrect) {
                    for (k = laststart; k < j; k++)
                        disptext[i]->chars[k].attr |= ATTR_INVALID;

                    dirtyrect = true;
                }
            }

            if (dirtyrect)
                disptext[i]->chars[j].attr |= ATTR_INVALID;
        }

        /*
         * Finally, loop once more and actually do the drawing.
         */
        bool dirty_run = (ldata->lattr != disptext[i]->lattr);
        bool dirty_line = dirty_run;
        disptext[i]->lattr = ldata->lattr;

        tc = erase_char.truecolor;
        for (j = 0; j < cols; j++) {
            termchar *d = &lchars[j];

            unsigned long tattr = newline[j].attr;
            unsigned long tchar = newline[j].chr;

            if ((disptext[i]->chars[j].attr ^ tattr) & ATTR_WIDE)
                dirty_line = true;

            bool break_run = ((tattr ^ attr) & attr_mask) != 0;
            if (!truecolor_equal(newline[j].truecolor, tc))
                break_run = true;

            /*
             * Break on both sides of any combined-character cell.
             */
            if (d->cc_next != 0 ||
                (j > 0 && d[-1].cc_next != 0))
                break_run = true;

            if (!dirty_line) {
                if (disptext[i]->chars[j].chr == tchar &&
                    (disptext[i]->chars[j].attr &~ DATTR_MASK)==tattr &&
                    truecolor_equal(
                        disptext[i]->chars[j].truecolor, tc))
                    break_run = true;
                else if (!dirty_run && ch.size() == 1)
                    break_run = true;
            }

            if (break_run) {
                if ((dirty_run || last_run_dirty) && !ch.empty())
                    do_paint_draw(ldata, start, i, ch.data(), ch.size(), attr, tc);
                start = j;
                ch.clear();
                attr = tattr;
                tc = newline[j].truecolor;
                dirty_run = dirty_line;
            }

            bool do_copy = false;
            if (!termchars_equal_override(&disptext[i]->chars[j], d, tchar, tattr))
            {
                do_copy = true;
                dirty_run = true;
            }

            if (tchar > 0x10000 && tchar < 0x110000) {
                ch.push_back(wchar_t(HIGH_SURROGATE_OF(tchar)));
                ch.push_back(wchar_t(LOW_SURROGATE_OF(tchar)));
            } else
                ch.push_back(wchar_t(tchar));

            if (d->cc_next) {
                termchar *dd = d;

                while (dd->cc_next) {
                    unsigned long schar;

                    dd += dd->cc_next;

                    schar = dd->chr;

                    if (schar > 0x10000 && schar < 0x110000) {
                        ch.push_back(wchar_t(HIGH_SURROGATE_OF(schar)));
                        ch.push_back(wchar_t(LOW_SURROGATE_OF(schar)));
                    } else
                        ch.push_back(wchar_t(schar));
                }

                attr |= TATTR_COMBINING;
            }

            if (do_copy) {
                copy_termchar(disptext[i], j, d);
                disptext[i]->chars[j].chr = tchar;
                disptext[i]->chars[j].attr = tattr;
                disptext[i]->chars[j].truecolor = tc;
                if (start == j)
                    disptext[i]->chars[j].attr |= DATTR_STARTRUN;
            }

            /* If it's a wide char step along to the next one. */
            if (tattr & ATTR_WIDE) {
                if (++j < cols) {
                    d++;
                    /*
                     * By construction above, the cursor should not
                     * be on the right-hand half of this character.
                     */
                    assert(!(i == our_curs_y && j == our_curs_x));
                    if (!termchars_equal(&disptext[i]->chars[j], d))
                        dirty_run = true;
                    copy_termchar(disptext[i], j, d);
                }
            }
        }
        if (dirty_run && !ch.empty())
            do_paint_draw(ldata, start, i, ch.data(), ch.size(), attr, tc);
    }
}

/*
 * Invalidate the whole screen so it will be repainted in full.
 */
void Terminal::term_invalidate()
{
    int i, j;

    for (i = 0; i < rows; i++)
        for (j = 0; j < cols; j++)
            disptext[i]->chars[j].attr |= ATTR_INVALID;

    schedule_update();
}

/*
 * Paint the window in response to a WM_PAINT message.
 */
void Terminal::term_paint(int left, int top, int right, int bottom, bool immediately)
{
    int i, j;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (right >= cols) right = cols-1;
    if (bottom >= rows) bottom = rows-1;

    for (i = top; i <= bottom && i < rows; i++) {
        if ((disptext[i]->lattr & LATTR_MODE) == LATTR_NORM)
            for (j = left; j <= right && j < cols; j++)
                disptext[i]->chars[j].attr |= ATTR_INVALID;
        else
            for (j = left / 2; j <= right / 2 + 1 && j < cols; j++)
                disptext[i]->chars[j].attr |= ATTR_INVALID;
    }

    if(immediately)
        do_paint();
    else
        schedule_update();
}

/*
 * Attempt to scroll the scrollback. The second parameter gives the
 * position we want to scroll to; the first is +1 to denote that
 * this position is relative to the beginning of the scrollback, -1
 * to denote it is relative to the end, and 0 to denote that it is
 * relative to the current position.
 */
void Terminal::term_scroll(int rel, int where)
{
    int sbtop = -sblines();

    disptop = (rel < 0 ? 0 : rel > 0 ? sbtop : disptop) + where;
    if(disptop < sbtop)
        disptop = sbtop;
    if(disptop > 0)
        disptop = 0;
    win_scrollbar_update_pending = true;
    schedule_update();
}

/*
 * Scroll the scrollback to centre it on the beginning or end of the
 * current selection, if any.
 */
void Terminal::term_scroll_to_selection(int which_end)
{
    pos target;
    int y;
    int sbtop = -sblines();

    if (selstate != SELECTED)
        return;
    if (which_end)
        target = selend;
    else
        target = selstart;

    y = target.y - rows/2;
    if (y < sbtop)
        y = sbtop;
    else if (y > 0)
        y = 0;
    term_scroll(-1, y);
}

void Terminal::clipme(pos top, pos bottom, bool rect, bool desel)
{
    wstring buf;
    int old_top_x = top.x;                 /* needed for rect==1 */

    while (poslt(top, bottom)) {
        bool nl = false;
        shared_ptr<termline> ldata = lineptr(top.y);
        pos nlpos;

        /*
         * nlpos will point at the maximum position on this line we
         * should copy up to. So we start it at the end of the
         * line...
         */
        nlpos.y = top.y;
        nlpos.x = cols;

        /*
         * ... move it backwards if there's unused space at the end
         * of the line (and also set `nl' if this is the case,
         * because in normal selection mode this means we need a
         * newline at the end)...
         */
        if (!(ldata->lattr & LATTR_WRAPPED)) {
            while (nlpos.x &&
                   IS_SPACE_CHR(ldata->chars[nlpos.x - 1].chr) &&
                   !ldata->chars[nlpos.x - 1].cc_next &&
                   poslt(top, nlpos))
                decpos(nlpos);
            if (poslt(nlpos, bottom))
                nl = true;
        } else {
            if (ldata->lattr & LATTR_WRAPPED2) {
                /* Ignore the last char on the line in a WRAPPED2 line. */
                decpos(nlpos);
            }
        }

        /*
         * ... and then clip it to the terminal x coordinate if
         * we're doing rectangular selection. (In this case we
         * still did the above, so that copying e.g. the right-hand
         * column from a table doesn't fill with spaces on the
         * right.)
         */
        if (rect) {
            if (nlpos.x > bottom.x)
                nlpos.x = bottom.x;
            nl = (top.y < bottom.y);
        }

        while (poslt(top, bottom) && poslt(top, nlpos)) {
            wchar_t cbuf[16], *p;
            int x = top.x;

            if (ldata->chars[x].chr == UCSWIDE) {
                top.x++;
                continue;
            }

            // XXX: what?
            while (1) {
                int uc = ldata->chars[x].chr;
                if (uc > 0x10000 && uc < 0x110000) {
                    cbuf[0] = 0xD800 | ((uc - 0x10000) >> 10);
                    cbuf[1] = 0xDC00 | ((uc - 0x10000) & 0x3FF);
                    cbuf[2] = 0;
                }
                else
                {
                    cbuf[0] = uc;
                    cbuf[1] = 0;
                }

                for (p = cbuf; *p; p++)
                    buf.push_back(*p);

                if (ldata->chars[x].cc_next)
                    x += ldata->chars[x].cc_next;
                else
                    break;
            }
            top.x++;
        }
        if (nl) {
            for (int i = 0; i < sel_nl_sz; i++)
                buf.push_back(sel_nl[i]);
        }
        top.y++;
        top.x = rect ? old_top_x : 0;
    }
    buf.push_back(0);

    // Finally, transfer all that to the clipboard.
    win->clip_write(buf.data(), buf.size(), desel);
}

void Terminal::term_copyall()
{
    pos top;
    pos bottom;
    top.y = -sblines();
    top.x = 0;
    bottom.y = find_last_nonempty_line(screen);
    bottom.x = cols;
    clipme(top, bottom, false, true);
}

void Terminal::term_request_paste()
{
    win->clip_request_paste();
}

/*
 * The wordness array is mainly for deciding the disposition of the
 * US-ASCII characters.
 */
int Terminal::wordtype(int uc) const
{
    struct ucsword {
        int start, end, ctype;
    };
    static const struct ucsword ucs_words[] = {
        { 128, 160, 0},
        { 161, 191, 1},
        { 215, 215, 1},
        { 247, 247, 1},
        { 0x037e, 0x037e, 1},            /* Greek question mark */
        { 0x0387, 0x0387, 1},            /* Greek ano teleia */
        { 0x055a, 0x055f, 1},            /* Armenian punctuation */
        { 0x0589, 0x0589, 1},            /* Armenian full stop */
        { 0x0700, 0x070d, 1},            /* Syriac punctuation */
        { 0x104a, 0x104f, 1},            /* Myanmar punctuation */
        { 0x10fb, 0x10fb, 1},            /* Georgian punctuation */
        { 0x1361, 0x1368, 1},            /* Ethiopic punctuation */
        { 0x166d, 0x166e, 1},            /* Canadian Syl. punctuation */
        { 0x17d4, 0x17dc, 1},            /* Khmer punctuation */
        { 0x1800, 0x180a, 1},            /* Mongolian punctuation */
        { 0x2000, 0x200a, 0},            /* Various spaces */
        { 0x2070, 0x207f, 2},            /* superscript */
        { 0x2080, 0x208f, 2},            /* subscript */
        { 0x200b, 0x27ff, 1},            /* punctuation and symbols */
        { 0x3000, 0x3000, 0},            /* ideographic space */
        { 0x3001, 0x3020, 1},            /* ideographic punctuation */
        { 0x303f, 0x309f, 3},            /* Hiragana */
        { 0x30a0, 0x30ff, 3},            /* Katakana */
        { 0x3300, 0x9fff, 3},            /* CJK Ideographs */
        { 0xac00, 0xd7a3, 3},            /* Hangul Syllables */
        { 0xf900, 0xfaff, 3},            /* CJK Ideographs */
        { 0xfe30, 0xfe6b, 1},            /* punctuation forms */
        { 0xff00, 0xff0f, 1},            /* half/fullwidth ASCII */
        { 0xff1a, 0xff20, 1},            /* half/fullwidth ASCII */
        { 0xff3b, 0xff40, 1},            /* half/fullwidth ASCII */
        { 0xff5b, 0xff64, 1},            /* half/fullwidth ASCII */
        { 0xfff0, 0xffff, 0},            /* half/fullwidth ASCII */
        { 0, 0, 0}
    };
    const struct ucsword *wptr;

    if (uc < 0x80)
        return wordness[uc];

    for (wptr = ucs_words; wptr->start; wptr++) {
        if (uc >= wptr->start && uc <= wptr->end)
            return wptr->ctype;
    }

    return 2;
}

int Terminal::line_cols(shared_ptr<termline> ldata) const
{
    int result = cols;
    if (ldata->lattr & LATTR_WRAPPED2)
        result--;
    if (result < 0)
        result = 0;
    return result;
}

/*
 * Spread the selection outwards according to the selection mode.
 */
pos Terminal::sel_spread_half(pos p, int dir)
{
    shared_ptr<termline> ldata;
    short wvalue;
    int topy = -sblines();

    ldata = lineptr(p.y);

    switch (selmode) {
    case Terminal::SM_CHAR:
        /*
         * In this mode, every character is a separate unit, except
         * for runs of spaces at the end of a non-wrapping line.
         */
        if (!(ldata->lattr & LATTR_WRAPPED)) {
            int pos = line_cols(ldata);
            while(pos > 0 &&
                  IS_SPACE_CHR(ldata->chars[pos-1].chr) && !ldata->chars[pos-1].cc_next)
                pos--;
            if(pos == cols)
                pos--;
            if (p.x >= pos)
                p.x = (dir == -1 ? pos : cols - 1);
        }
        break;
      case Terminal::SM_WORD:
        /*
         * In this mode, the units are maximal runs of characters
         * whose `wordness' has the same value.
         */
        wvalue = wordtype(UCSGET(ldata->chars, p.x));
        if (dir == +1) {
            while (1) {
                int maxcols = line_cols(ldata);
                if (p.x < maxcols-1) {
                    if (wordtype(UCSGET(ldata->chars, p.x+1)) == wvalue)
                        p.x++;
                    else
                        break;
                } else {
                    if (p.y+1 < rows &&
                        (ldata->lattr & LATTR_WRAPPED)) {
                        shared_ptr<termline> ldata2;
                        ldata2 = lineptr(p.y+1);
                        if (wordtype(UCSGET(ldata2->chars, 0))
                            == wvalue) {
                            p.x = 0;
                            p.y++;
                            ldata = ldata2;
                        } else {
                            break;
                        }
                    } else
                        break;
                }
            }
        } else {
            while (1) {
                if (p.x > 0) {
                    if (wordtype(UCSGET(ldata->chars, p.x-1)) == wvalue)
                        p.x--;
                    else
                        break;
                } else {
                    shared_ptr<termline> ldata2;
                    int maxcols;
                    if (p.y <= topy)
                        break;
                    ldata2 = lineptr(p.y-1);
                    maxcols = line_cols(ldata2);
                    if (ldata2->lattr & LATTR_WRAPPED) {
                        if (wordtype(UCSGET(ldata2->chars, maxcols-1))
                            == wvalue) {
                            p.x = maxcols-1;
                            p.y--;
                            ldata = ldata2;
                        } else {
                            break;
                        }
                    } else
                        break;
                }
            }
        }
        break;
      case Terminal::SM_LINE:
        /*
         * In this mode, every line is a unit.
         */
        p.x = (dir == -1 ? 0 : cols - 1);
        break;
    }

    return p;
}

void Terminal::sel_spread()
{
    if (seltype == LEXICOGRAPHIC) {
        selstart = sel_spread_half(selstart, -1);
        decpos(selend);
        selend = sel_spread_half(selend, +1);
        incpos(selend);
    }
}

void Terminal::term_paste_callback(void *ptr)
{
    Terminal *term = (Terminal *)ptr;
    term->term_paste();
}

void Terminal::term_paste()
{
    if(paste_buffer.empty())
        return;

    if(paste_pos >= paste_buffer.size())
        return;
    // Send a line at a time to term_keyinput_internal.
    int n = 0;
    while (n + paste_pos < paste_buffer.size()) {
        if (paste_buffer[paste_pos + n++] == '\r')
            break;
    }
    term_keyinput_internal(paste_buffer.c_str(), paste_buffer.size(), false);
    paste_pos += n;

    if (paste_pos == paste_buffer.size())
    {
        // We're done pasting.
        paste_buffer.clear();
        return;
    }

    // Post a callback to send the next line, so we let other things happen
    // as we paste.
    callback::post(term_paste_callback, this);
}

void Terminal::term_do_paste(const wstring &data)
{
    /*
     * Pasting data into the terminal counts as a keyboard event (for
     * purposes of the 'Reset scrollback on keypress' config option),
     * unless the paste is zero-length.
     */
    if(data.empty())
        return;

    wstring wide_paste_buffer;
    for(int i = 0; i < data.size(); ++i)
    {
        wchar_t wc = data[i];

        if (wc == '\r' && i+1 < data.size() && data[i+1] == '\n')
        {
            // Replace CRLF with a press of CR.
            i++; // skip LF
            wide_paste_buffer.push_back('\015');
            continue;
        }

        if ((wc & ~(wint_t)0x9F) == 0)
        {
            // This is a control code, either in the range 0x00-0x1F
            // or 0x80-0x9F. We reject all of these in pastecontrols
            // mode, except for a small set of permitted ones.
            //
            // In line with xterm 292, accepted control chars are:
            // CR, LF, tab, backspace. (And DEL, i.e. 0x7F, but
            // that's permitted by virtue of not matching the bit
            // mask that got us into this if statement, so we
            // don't have to permit it here. */
            static const unsigned mask = (1<<13) | (1<<10) | (1<<9) | (1<<8);
            if (wc > 15 || !((mask >> wc) & 1))
                continue;
        }

        wide_paste_buffer.push_back(wc);
    }

    paste_pos = 0;
    paste_buffer = term_input_data_from_unicode(wide_paste_buffer);

    /* Assume a small paste will be OK in one go. */
    if (paste_buffer.size() < 256) {
        term_keyinput_internal(paste_buffer.c_str(), paste_buffer.size(), false);
        paste_buffer.clear();
        paste_pos = 0;
    }

    callback::post(term_paste_callback, this);
}

void Terminal::term_mouse_action(Mouse_Button braw, Mouse_Button bcooked,
                Mouse_Action a, int x, int y, bool shift, bool ctrl, bool alt)
{
    pos selpoint;
    shared_ptr<termline> ldata;
    bool raw_mouse = (xterm_mouse && !shift);
    seltype_t default_seltype;

    if (y < 0) {
        y = 0;
        if (a == MA_DRAG && !raw_mouse)
            term_scroll(0, -1);
    }
    if (y >= rows) {
        y = rows - 1;
        if (a == MA_DRAG && !raw_mouse)
            term_scroll(0, +1);
    }
    if (x < 0) {
        if (y > 0 && !raw_mouse && seltype != RECTANGULAR) {
            /*
             * When we're using the mouse for normal raster-based
             * selection, dragging off the left edge of a terminal row
             * is treated the same as the right-hand end of the
             * previous row, in that it's considered to identify a
             * point _before_ the first character on row y.
             *
             * But if the mouse action is going to be used for
             * anything else - rectangular selection, or xterm mouse
             * tracking - then we disable this special treatment.
             */
            x = cols - 1;
            y--;
        } else
            x = 0;
    }
    if (x >= cols)
        x = cols - 1;

    selpoint.y = y + disptop;
    ldata = lineptr(selpoint.y);

    if ((ldata->lattr & LATTR_MODE) != LATTR_NORM)
        x /= 2;

    selpoint.x = x;

    /*
     * If we're in the middle of a selection operation, we ignore raw
     * mouse mode until it's done (we must have been not in raw mouse
     * mode when it started).
     * This makes use of Shift for selection reliable, and avoids the
     * host seeing mouse releases for which they never saw corresponding
     * presses.
     */
    if (raw_mouse && selstate != ABOUT_TO && selstate != DRAGGING) {
        int encstate = 0, r, c;
        bool wheel;
        char abuf[32];
        int len = 0;

        switch (braw) {
        case MBT_LEFT:
            encstate = 0x00;               /* left button down */
            wheel = false;
            break;
        case MBT_MIDDLE:
            encstate = 0x01;
            wheel = false;
            break;
        case MBT_RIGHT:
            encstate = 0x02;
            wheel = false;
            break;
        case MBT_WHEEL_UP:
            encstate = 0x40;
            wheel = true;
            break;
        case MBT_WHEEL_DOWN:
            encstate = 0x41;
            wheel = true;
            break;
        default:
            return;
        }
        if (wheel) {
            /* For mouse wheel buttons, we only ever expect to see
                * MA_CLICK actions, and we don't try to keep track of
                * the buttons being 'pressed' (since without matching
                * click/release pairs that's pointless). */
            if (a != MA_CLICK)
                return;
        } else switch (a) {
            case MA_DRAG:
            if (xterm_mouse == 1)
                return;
            encstate += 0x20;
            break;
            case MA_RELEASE:
            /* If multiple extensions are enabled, the xterm 1006 is used, so it's okay to check for only that */
            if (!xterm_extended_mouse)
                encstate = 0x03;
            mouse_is_down = 0;
            break;
            case MA_CLICK:
            if (mouse_is_down == braw)
                return;
            mouse_is_down = braw;
            break;
            default:
            return;
        }
        if (shift)
            encstate += 0x04;
        if (ctrl)
            encstate += 0x10;
        r = y + 1;
        c = x + 1;

        /* Check the extensions in decreasing order of preference. Encoding the release event above assumes that 1006 comes first. */
        if (xterm_extended_mouse) {
            len = sprintf(abuf, "\033[<%d;%d;%d%c", encstate, c, r, a == MA_RELEASE ? 'm' : 'M');
        } else if (urxvt_extended_mouse) {
            len = sprintf(abuf, "\033[%d;%d;%dM", encstate + 32, c, r);
        } else if (c <= 223 && r <= 223) {
            len = sprintf(abuf, "\033[M%c%c%c", encstate + 32, c + 32, r + 32);
        }
        if (len > 0)
            client->send(abuf, len);
        return;
    }

    default_seltype = LEXICOGRAPHIC;

    if (selstate == NO_SELECTION)
        seltype = default_seltype;

    if (bcooked == MBT_SELECT && a == MA_CLICK) {
        deselect();
        selstate = ABOUT_TO;
        seltype = default_seltype;
        selanchor = selpoint;
        selmode = Terminal::SM_CHAR;
    } else if (bcooked == MBT_SELECT && (a == MA_2CLK || a == MA_3CLK)) {
        deselect();
        selmode = (a == MA_2CLK ? Terminal::SM_WORD : Terminal::SM_LINE);
        selstate = DRAGGING;
        selstart = selanchor = selpoint;
        selend = selstart;
        incpos(selend);
        sel_spread();
    } else if ((bcooked == MBT_SELECT && a == MA_DRAG) ||
               (bcooked == MBT_EXTEND && a != MA_RELEASE)) {
        if (a == MA_DRAG &&
            (selstate == NO_SELECTION || selstate == SELECTED)) {
            /*
             * This can happen if a front end has passed us a MA_DRAG
             * without a prior MA_CLICK. OS X GTK does so, for
             * example, if the initial button press was eaten by the
             * WM when it activated the window in the first place. The
             * nicest thing to do in this situation is to ignore
             * further drags, and wait for the user to click in the
             * window again properly if they want to select.
             */
            return;
        }
        if (selstate == ABOUT_TO && poseq(selanchor, selpoint))
            return;
        if (bcooked == MBT_EXTEND && a != MA_DRAG &&
            selstate == SELECTED) {
            if (seltype == LEXICOGRAPHIC) {
                /*
                 * For normal selection, we extend by moving
                 * whichever end of the current selection is closer
                 * to the mouse.
                 */
                if (posdiff(selpoint, selstart) <
                    posdiff(selend, selstart) / 2) {
                    selanchor = selend;
                    decpos(selanchor);
                } else {
                    selanchor = selstart;
                }
            } else {
                /*
                 * For rectangular selection, we have a choice of
                 * _four_ places to put selanchor and selpoint: the
                 * four corners of the selection.
                 */
                if (2*selpoint.x < selstart.x + selend.x)
                    selanchor.x = selend.x-1;
                else
                    selanchor.x = selstart.x;

                if (2*selpoint.y < selstart.y + selend.y)
                    selanchor.y = selend.y;
                else
                    selanchor.y = selstart.y;
            }
            selstate = DRAGGING;
        }
        if (selstate != ABOUT_TO && selstate != DRAGGING)
            selanchor = selpoint;
        selstate = DRAGGING;
        if (seltype == LEXICOGRAPHIC) {
            /*
             * For normal selection, we set (selstart,selend) to
             * (selpoint,selanchor) in some order.
             */
            if (poslt(selpoint, selanchor)) {
                selstart = selpoint;
                selend = selanchor;
                incpos(selend);
            } else {
                selstart = selanchor;
                selend = selpoint;
                incpos(selend);
            }
        } else {
            /*
             * For rectangular selection, we may need to
             * interchange x and y coordinates (if the user has
             * dragged in the -x and +y directions, or vice versa).
             */
            selstart.x = min(selanchor.x, selpoint.x);
            selend.x = 1+max(selanchor.x, selpoint.x);
            selstart.y = min(selanchor.y, selpoint.y);
            selend.y =   max(selanchor.y, selpoint.y);
        }
        sel_spread();
    } else if ((bcooked == MBT_SELECT || bcooked == MBT_EXTEND) &&
               a == MA_RELEASE) {
        if (selstate == DRAGGING) {
            /*
             * We've completed a selection. We now transfer the
             * data to the clipboard.
             */
            clipme(selstart, selend, (seltype == RECTANGULAR), false);
            selstate = SELECTED;
        } else
            selstate = NO_SELECTION;
    } else if (bcooked == MBT_PASTE
               && (a == MA_CLICK || a == MA_2CLK || a == MA_3CLK))
    {
        term_request_paste();
    }

    /*
     * Since terminal output is suppressed during drag-selects, we
     * should make sure to write any pending output if one has just
     * finished.
     */
    term_out();
    schedule_update();
}

void Terminal::term_cancel_selection_drag()
{
    /*
     * In unusual circumstances, a mouse drag might be interrupted by
     * something that steals the rest of the mouse gesture. An example
     * is the GTK popup menu appearing. In that situation, we'll never
     * receive the MA_RELEASE that finishes the DRAGGING state, which
     * means terminal output could be suppressed indefinitely. Call
     * this function from the front end in such situations to restore
     * sensibleness.
     */
    if (selstate == DRAGGING)
        selstate = NO_SELECTION;
    term_out();
    schedule_update();
}

static int shift_bitmap(bool shift, bool ctrl, bool alt, bool *consumed_alt)
{
    int bitmap = (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
    if (bitmap)
        bitmap++;
    if (alt && consumed_alt)
        *consumed_alt = true;
    return bitmap;
}

int format_arrow_key(char *buf, Terminal *term, int xkey,
                     bool shift, bool ctrl, bool alt, bool *consumed_alt)
{
    char *p = buf;

    bool app_flg = term->app_cursor_keys;

    /* Adjustment based on Shift, Ctrl and/or Alt */
    if (ctrl)
        app_flg = !app_flg;

    if (app_flg)
        p += sprintf(p, "\x1BO%c", xkey);
    else
        p += sprintf(p, "\x1B[%c", xkey);

    return int(p - buf);
}

int format_function_key(char *buf, Terminal *term, int key_number,
                        bool shift, bool ctrl, bool alt, bool *consumed_alt)
{
    char *p = buf;

    static const int key_number_to_tilde_code[] = {
        -1,                 /* no such key as F0 */
        11, 12, 13, 14, 15, /*gap*/ 17, 18, 19, 20, 21, /*gap*/
        23, 24, 25, 26, /*gap*/ 28, 29, /*gap*/ 31, 32, 33, 34,
    };

    assert(key_number > 0);
    assert(key_number < lenof(key_number_to_tilde_code));

    int index = key_number;
    if (shift && index <= 10) {
        shift = false;
        index += 10;
    }

    int code = key_number_to_tilde_code[index];

    if (code >= 11 && code <= 24) {
        int offt = 0;
        if (code > 15)
            offt++;
        if (code > 21)
            offt++;
        p += sprintf(p, "\x1BO%c", code + 'P' - 11 - offt);
    } else {
        int bitmap = 0;
        if (bitmap)
            p += sprintf(p, "\x1B[%d;%d~", code, bitmap);
        else
            p += sprintf(p, "\x1B[%d~", code);
    }

    return int(p - buf);
}

int format_small_keypad_key(char *buf, Terminal *term, SmallKeypadKey key)
{
    char *p = buf;

    int code;
    switch (key) {
      case SKK_HOME: code = 1; break;
      case SKK_INSERT: code = 2; break;
      case SKK_DELETE: code = 3; break;
      case SKK_END: code = 4; break;
      case SKK_PGUP: code = 5; break;
      case SKK_PGDN: code = 6; break;
      default: unreachable("bad small keypad key enum value");
    }

    p += sprintf(p, "\x1B[%d~", code);

    return int(p - buf);
}

int format_numeric_keypad_key(char *buf, Terminal *term, char key,
                              bool shift, bool ctrl)
{
    char *p = buf;

    int xkey = 0;

    if (term->app_keypad_keys) {
        switch (key) {
        case '0': xkey = 'p'; break;
        case '1': xkey = 'q'; break;
        case '2': xkey = 'r'; break;
        case '3': xkey = 's'; break;
        case '4': xkey = 't'; break;
        case '5': xkey = 'u'; break;
        case '6': xkey = 'v'; break;
        case '7': xkey = 'w'; break;
        case '8': xkey = 'x'; break;
        case '9': xkey = 'y'; break;
        case '.': xkey = 'n'; break;
        case '\r': xkey = 'M'; break;

        case 'G': xkey = 'P'; break;
        case '/': xkey = 'Q'; break;
        case '*': xkey = 'R'; break;
        case '-': xkey = 'S'; break;

        case '+':
            /*
             * Keypad + is tricky. It covers a space that would
             * be taken up on the VT100 by _two_ keys; so we
             * let Shift select between the two.
             */
            xkey = shift ? 'm' : 'l';
            break;
        }
    }

    if (xkey)
        p += sprintf(p, "\x1BO%c", xkey);

    return int(p - buf);
}

void Terminal::term_keyinputw(const wchar_t *widebuf, int len)
{
    string buf = term_input_data_from_unicode(wstring(widebuf, len));
    if(buf.size())
        term_keyinput_internal(buf.c_str(), buf.size(), true);
}

void Terminal::term_keyinput(int codepage, const char *str, int len)
{
    if (codepage < 0) {
        /*
         * This text needs no translation, either because it's already
         * in the right character set, or because we got the special
         * codepage value -1 from our caller which means 'this data
         * should be charset-agnostic, just send it raw' (for really
         * simple things like control characters).
         */
        term_keyinput_internal(str, len, true);
    } else {
        string buf = term_input_data_from_charset(codepage, str, len);
        if (buf.size())
            term_keyinput_internal(buf.c_str(), buf.size(), true);
    }
}

void Terminal::term_nopaste()
{
    paste_buffer.clear();
}

void Terminal::deselect()
{
    selstate = NO_SELECTION;
    selstart.x = selstart.y = selend.x = selend.y = 0;
}

void Terminal::term_lost_clipboard_ownership()
{
    deselect();
    term_update();

    /*
     * Since terminal output is suppressed during drag-selects, we
     * should make sure to write any pending output if one has just
     * finished.
     */
    term_out();
}

void Terminal::term_added_data()
{
    if (!in_term_out) {
        in_term_out = true;
        saw_disp_event();
        term_out();
        in_term_out = false;
    }
}

void Terminal::term_data(const void *data, size_t len)
{
    inbuf.add(data, len);
    term_added_data();
}

void Terminal::term_set_focus(bool has_focus_)
{
    has_focus = has_focus_;
}

void Terminal::term_notify_minimized(bool minimized_)
{
    minimized = minimized_;
}
