#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <time.h>
#include <limits.h>
#include <assert.h>
#include <shellscalingapi.h>

#include <functional>
#include <memory>
using namespace std;

#include <winuser.h>

#include "internal.h"
#include "window.h"
#include "backend.h"
#include "backend_pty.h"
#include "terminal.h"
#include "putty-rc.h"
#include "callback.h"
#include "handle_wait.h"
#include "timing.h"
#include "unicode.h"

#pragma comment(lib, "Imm32.lib")
#pragma comment(lib, "shcore.lib")

// A helper for running a window in a thread:
//
// - Creating and running the window in a thread
// - Sending blocking messages to it from another thread and receiving responses
// - Shutting down cleanly
class ThreadedWindow
{
public:
    HINSTANCE hinst = nullptr;
    bool CreatedWindowClass = false;
    typedef function<LRESULT(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)> UserWndProcFunc;
    UserWndProcFunc UserWndProc;
    wstring WindowClassName;
    HWND hwnd = nullptr;

    ThreadedWindow()
    {
        // Get our HINSTANCE.  One of these is passed to WinMain, but instead of making
        // the caller find it and pass it along, just make our own.
        char path[MAX_PATH];
        GetModuleFileName(NULL, path, MAX_PATH);
        hinst = LoadLibrary(path);
    }

    // Note that RealWindowClass.lpfnWndProc is unused.  Pass the WndProc to Create
    // instead.
    void CreateWindowClass(string name, HICON icon)
    {
        assert(!CreatedWindowClass);
        CreatedWindowClass = true;

        // Remember the window class name.
        WindowClassName = utf8_to_wstring(name);

        WNDCLASSW WindowClass = {0};
        WindowClass.lpfnWndProc = InitialWndProc;
        WindowClass.hInstance = hinst;
        WindowClass.hIcon = icon;
        WindowClass.hCursor = LoadCursor(NULL, IDC_IBEAM);
        WindowClass.lpszClassName = WindowClassName.c_str();
        RegisterClassW(&WindowClass);
    }

    HWND Create(
        UserWndProcFunc WndProc,
        DWORD dwExStyle, LPCWSTR lpWindowName, DWORD dwStyle,
        int X, int Y, int nWidth, int nHeight,
        HWND hWndParent, HMENU hMenu, HINSTANCE hInstance)
    {
        assert(CreatedWindowClass);

        UserWndProc = WndProc;

        hwnd = CreateWindowExW(0, WindowClassName.c_str(), lpWindowName,
            dwStyle, X, Y, nWidth, nHeight, hWndParent, hMenu, hinst, this);

        return hwnd;
    }

    static LRESULT CALLBACK InitialWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
    {
        if(message != WM_NCCREATE)
            return DefWindowProcW(hwnd, message, wParam, lParam);

        CREATESTRUCTW *create = (CREATESTRUCTW *) lParam;
        ThreadedWindow *self = (ThreadedWindow *) create->lpCreateParams;

        // Point the USERDATA pointer to our object, and switch to RealWndProc.
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR) self);
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC,(LONG_PTR) WndProcStub);
        return WndProcStub(hwnd, message, wParam, lParam);
    }

    static LRESULT CALLBACK WndProcStub(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
    {
        ThreadedWindow *self = (ThreadedWindow *) GetWindowLongPtr(hwnd, GWLP_USERDATA);
        return self->WndProc(hwnd, message, wParam, lParam);
    }

    // Just call the user's WndProc.
    LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
    {
        return UserWndProc(hwnd, message, wParam, lParam);
    }
};

// Our WndProc messages:
enum {
    // We're going to destroy the clipboard while pasting, and we don't want this
    // to cause the selection to be lost, which normally happens if something else
    // changes the clipboard.
    WM_APP_IGNORE_CLIP = WM_APP,
    WM_APP_TIMER_CHANGE,

    // These messages are posted from ThreadedTerminalWindow.
    WM_APP_SET_VISIBLE,
    WM_APP_GET_VISIBLE,
    WM_APP_GET_HANDLES, // see GetHandles
    WM_APP_GET_NEXT_EVENT,
    WM_APP_SHUTDOWN,
};

// WM_APP_GET_HANDLES lParam to store the result.
struct GetHandles
{
    HANDLE *input = nullptr;
    HANDLE *output = nullptr;
    HANDLE *events = nullptr;
};

#define FONT_NORMAL 0
#define FONT_BOLD 1
#define FONT_UNDERLINE 2
#define FONT_WIDE       0x04
#define FONT_HIGH       0x08
#define FONT_NARROW     0x10

#define FONT_MAXNO      0x40
#define FONT_SHIFT      5

#define IS_HIGH_VARSEL(wch1, wch2) \
    ((wch1) == 0xDB40 && ((wch2) >= 0xDD00 && (wch2) <= 0xDDEF))
#define IS_LOW_VARSEL(wch) \
    (((wch) >= 0x180B && (wch) <= 0x180D) || /* MONGOLIAN FREE VARIATION SELECTOR */ \
     ((wch) >= 0xFE00 && (wch) <= 0xFE0F)) /* VARIATION SELECTOR 1-16 */

// TermWinWindows is the main terminal window implementation.  This is the top level:
// it creates and handles the window itself, interfaces to the terminal interpreter
// and the backend, and provides the main VVTerm interface.
class TermWinWindows: public TerminalInterface, public BackendInterface
{
public:
    //
    // BackendInterface
    //
    void output(const void *data, size_t len) override
    {
        term->term_data(data, len);
    }

    //
    // TerminalInterface
    //
    bool setup_draw_ctx() override;
    void draw_text(int x, int y, wchar_t *text, int len, unsigned long attrs, int line_attrs, truecolor tc) override;
    void draw_cursor(int x, int y, wchar_t *text, int len,
                        unsigned long attrs, int line_attrs, truecolor tc) override;
    int get_char_width(int uc) override;
    void free_draw_ctx() override;

    void set_cursor_pos(int x, int y) override;
    void set_raw_mouse_mode(bool enable) override;
    void set_raw_mouse_mode_pointer(bool enable) override;
    void set_scrollbar(int total, int start, int page) override;

    void clip_write(wchar_t *text, int len, bool must_deselect) override;
    void clip_request_paste() override;

    void refresh() override;

    void request_resize(int w, int h) override;

    void set_title(string title) override;

    void move(int x, int y) override;
    void palette_set(unsigned start, unsigned ncolors, const rgb *colors) override;
    void unthrottle(size_t bufsize) override;

    //
    // Implementation
    //
    void close_session();

    TermWinWindows();
    ~TermWinWindows();

    ThreadedWindow threaded_window;

    // Run the message loop.
    int run();

    Mouse_Button translate_button(Mouse_Button button);

    int TranslateKey(UINT message, WPARAM wParam, LPARAM lParam, unsigned char *output);
    void init_palette();
    void init_fonts(int pick_width, int pick_height);
    void init_dpi_info();
    void create_font(int fontno);
    void deinit_fonts();
    void set_input_locale(HKL kl);
    void click(Mouse_Button b, int x, int y, bool shift, bool ctrl, bool alt);

    RECT get_fullscreen_rect();
    void process_clipdata(HGLOBAL clipdata, bool unicode);

    void reset_window(int reinit);

    void sys_cursor_update();
    void general_textout(HDC hdc, int x, int y, CONST RECT *lprc,
        const WCHAR *lpString, UINT cbCount, CONST INT *lpDx, bool opaque);
    int get_font_width(HDC hdc, const TEXTMETRIC *tm);

    void wm_size_resize_term(LPARAM lParam, bool border);
    void draw_horizontal_line_on_text(int y, int lattr, RECT line_box, COLORREF color);
    void do_text_internal(int x, int y, wchar_t *text, int len,
        unsigned long attr, int lattr, truecolor truecolor);
    void recompute_window_offset();
    LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    void update_mouse_pointer();
    void timer_change(unsigned long next);

    HDC make_hdc();
    void free_hdc(HDC hdc);

    // Data
    HWND hwnd = nullptr;
    HINSTANCE hinst = nullptr;
    HDC wintw_hdc = nullptr;

    shared_ptr<Backend> backend;
    shared_ptr<Terminal> term;
    shared_ptr<TermConfig> conf;

    //
    // API events
    //
    // API events waiting to be picked up by the user.
    list<VVTermEvent> vvterm_events;
    shared_ptr<HandleHolder> vvterm_event_handle;
    void send_vvterm_event(VVTermEvent event);

    // Return the next event queued with send_vvterm_event, or VVTermEvent_None
    // if the queue is empty.
    VVTermEvent vvterm_event_pop()
    {
        if(vvterm_events.empty())
            return VVTermEvent_None;

        VVTermEvent result = vvterm_events.front();
        vvterm_events.pop_front();
        return result;
    }

    // These functions can be called from any thread.
    VVTermEvent threaded_get_next_event()
    {
        VVTermEvent event = VVTermEvent_Invalid;
        int success = (int) SendMessage(hwnd, WM_APP_GET_NEXT_EVENT, 0, (intptr_t) &event);
        if(success)
            return event;

        // If the window is no longer running to respond to the message.  This should
        // mean that VVTermEvent_Shutdown was queued, then the window exited before it
        // was popped.  Just pop any remaining events directly.
        return vvterm_event_pop();
    }

    HFONT fonts[FONT_MAXNO];
    LOGFONT lfont;
    int descent, font_strikethrough_y;

    struct dpi_info_t {
        POINT cur_dpi;
        RECT new_wnd_rect;
    } dpi_info;

    enum {
        UND_LINE, UND_FONT
    } und_mode;

    int compose_state = 0;
    string window_name;
    bool pointer_indicates_raw_mouse = false;

    int dbltime = 0, lasttime = 0;
    Mouse_Action lastact = MA_NOTHING;
    Mouse_Button lastbtn = MBT_NOTHING;

    COLORREF colors[OSC4_NCOLORS];
    HPALETTE pal;
    PALETTEENTRY palette_entries[OSC4_NCOLORS];
    COLORREF colorref_modifier = 0;

    HBITMAP caretbm;

    bool resizing = false;

    /* this allows xterm-style mouse handling. */
    bool send_raw_mouse = false;
    int wheel_accumulator = 0;

    // Window layout information
    int extra_width = 20, extra_height = 28;
    int font_width = 10, font_height = 20;
    bool font_dualwidth = 1, font_varpitch = 1;
    int offset_width = 1, offset_height = 1;
    bool was_zoomed = false;
    int prev_rows = 0, prev_cols = 0;

    int caret_x = -1, caret_y = -1;

    int kbd_codepage = 0;
    bool sent_term_size = false; // only live during wintw_request_resize()

    bool session_closed = false;
    bool reconfiguring = false;

#define TIMING_TIMER_ID 1234
    long timing_next_time = 0;
};

void TermWinWindows::close_session()
{
    session_closed = true;

    // Send a final event to let the user know that we're shutting down, so it
    // should destroy its copy of the event handle.
    send_vvterm_event(VVTermEvent_Shutdown);

    if (backend) {
        backend->shutdown();
        backend.reset();
    }
    term->term_provide_backend(nullptr);

    hwnd = NULL;
}

TermWinWindows::TermWinWindows()
{
    {
        // Get our HINSTANCE.  One of these is passed to WinMain, but instead of making
        // the caller find it and pass it along, just make our own.
        char path[MAX_PATH];
        GetModuleFileName(NULL, path, MAX_PATH);
        hinst = LoadLibrary(path);
    }

    conf = make_shared<TermConfig>();

    int guess_width = extra_width + font_width * conf->width;
    int guess_height = extra_height + font_height*conf->height;
    {
        RECT r = get_fullscreen_rect();
        if (guess_width > r.right - r.left)
            guess_width = r.right - r.left;
        if (guess_height > r.bottom - r.top)
            guess_height = r.bottom - r.top;
    }

    window_name = appname;
    HANDLE hhh = CreateEvent(nullptr, false, false, nullptr);
    vvterm_event_handle = make_shared<HandleHolder>(hhh);

    // Create the window class.
    HICON icon = LoadIcon(hinst, MAKEINTRESOURCE(IDI_MAINICON));
    threaded_window.CreateWindowClass(appname, icon);

    // Create the window.
    hwnd = threaded_window.Create(
        [this](HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) { return WndProc(hwnd, message, wParam, lParam); },
        0, utf8_to_wstring(window_name).c_str(),
        WS_OVERLAPPEDWINDOW | WS_VSCROLL,
        CW_USEDEFAULT, CW_USEDEFAULT,
        guess_width, guess_height, NULL, NULL, hinst);

    if(!hwnd)
    {
        string message = ssprintf("Unable to create terminal window: %s", win_strerror(GetLastError()).c_str());
        MessageBox(hwnd, message.c_str(), "Fatal Error", MB_SYSTEMMODAL | MB_ICONERROR | MB_OK);
        exit(1);
    }

    memset(&dpi_info, 0, sizeof(dpi_info));

    init_dpi_info();

    // Initialise the fonts, simultaneously correcting the guesses for font_{width,height}.
    init_fonts(0,0);

    // Prepare the logical palette.
    init_palette();

    // Tell timing who to inform about timers.
    timing_set_hwnd(hwnd, WM_APP_TIMER_CHANGE);

    term = make_shared<Terminal>();
    term->init(conf, this);
    term->term_size(conf->height, conf->width, conf->savelines);

    // Correct the guesses for extra_{width,height}.
    {
        RECT cr, wr;
        GetWindowRect(hwnd, &wr);
        GetClientRect(hwnd, &cr);
        offset_width = offset_height = conf->window_border;
        extra_width = wr.right - wr.left - cr.right + cr.left + offset_width*2;
        extra_height = wr.bottom - wr.top - cr.bottom + cr.top +offset_height*2;
    }

    // Resize the window, now we know what size we _really_ want it to be.
    guess_width = extra_width + font_width * term->cols;
    guess_height = extra_height + font_height * term->rows;
    SetWindowPos(hwnd, NULL, 0, 0, guess_width, guess_height, SWP_NOMOVE | SWP_NOREDRAW | SWP_NOZORDER);

    // Set up a caret bitmap, with no content.
    {
        int size = (font_width + 15) / 16 * 2 * font_height;
        caretbm = CreateBitmap(font_width, font_height, 1, 1, string(size, 0).data());
    }
    CreateCaret(hwnd, caretbm, font_width, font_height);

    // Initialize the scrollbar.
    {
        SCROLLINFO si;

        si.cbSize = sizeof(si);
        si.fMask = SIF_ALL | SIF_DISABLENOSCROLL;
        si.nMin = 0;
        si.nMax = term->rows - 1;
        si.nPage = term->rows;
        si.nPos = 0;
        SetScrollInfo(hwnd, SB_VERT, &si, false);
    }

    // Prepare the mouse handler.
    lastact = MA_NOTHING;
    lastbtn = MBT_NOTHING;
    dbltime = GetDoubleClickTime();

    backend = Create_Backend_PTY(this, conf);
    string error = backend->init();

    // Errors here are unexpected.
    if(!error.empty())
    {
        MessageBox(NULL, error.c_str(), "Fatal error", MB_ICONERROR | MB_OK);
        exit(0);
    }

    term->term_setup_window_titles("vview");

    // Connect the terminal to the backend for resize purposes.
    term->term_provide_backend(backend);

    // Set up the initial input locale.
    set_input_locale(GetKeyboardLayout(0));
}

int TermWinWindows::run()
{
    while (1) {
        // If we know we have something to do (a window message or a callback), run what
        // we have until we run out of tasks.  If we have nothing at all, run with an infinite
        // timeout to wait for something to happen.
        DWORD timeout = 0;
        MSG msg;
        if (!callback::pending() && !PeekMessage(&msg, NULL, 0, 0, PM_NOREMOVE)) {
            timeout = INFINITE;

            // The messages seem unreliable; especially if we're being tricky
            term->term_set_focus(GetForegroundWindow() == hwnd);
        }

        HandleWait::wait(timeout);

        while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT)
                return int(msg.wParam);

            DispatchMessageW(&msg);
        }

        callback::run_pending();
    }
}

TermWinWindows::~TermWinWindows()
{
    deinit_fonts();

    timing_set_hwnd(nullptr, 0);

    // XXX
    if(pal)
        DeleteObject(pal);
}

void TermWinWindows::update_mouse_pointer()
{
    LPTSTR curstype = pointer_indicates_raw_mouse? IDC_ARROW:IDC_IBEAM;
    HCURSOR cursor = LoadCursor(NULL, curstype);
    SetClassLongPtr(hwnd, GCLP_HCURSOR, (LONG_PTR)cursor);
    SetCursor(cursor); /* force redraw of cursor at current posn */
}

void TermWinWindows::set_raw_mouse_mode(bool activate)
{
    send_raw_mouse = activate;
}

void TermWinWindows::set_raw_mouse_mode_pointer(bool activate)
{
    pointer_indicates_raw_mouse = activate;
    update_mouse_pointer();
}

static inline rgb rgb_from_colorref(COLORREF cr)
{
    rgb toret;
    toret.r = GetRValue(cr);
    toret.g = GetGValue(cr);
    toret.b = GetBValue(cr);
    return toret;
}

/*
 * The exact_textout() wrapper, unfortunately, destroys the useful
 * Windows `font linking' behaviour: automatic handling of Unicode
 * code points not supported in this font by falling back to a font
 * which does contain them. Therefore, we adopt a multi-layered
 * approach: for any potentially-bidi text, we use exact_textout(),
 * and for everything else we use a simple ExtTextOut as we did
 * before exact_textout() was introduced.
 */
void TermWinWindows::general_textout(HDC hdc, int x, int y, CONST RECT *lprc,
                            const WCHAR *lpString, UINT cbCount,
                            CONST INT *lpDx, bool opaque)
{
    int bkmode = 0;
    bool got_bkmode = false;

    int xp = x;
    int xn = xp;
    for (int i = 0; i < (int)cbCount ;) {
        xn += lpDx[i];

        int j;
        for (j = i+1; j < (int)cbCount; j++)
            xn += lpDx[j];

        ExtTextOutW(hdc, xp, y, ETO_CLIPPED | (opaque ? ETO_OPAQUE : 0),
                    lprc, lpString+i, j-i, font_varpitch ? NULL : lpDx+i);

        i = j;
        xp = xn;

        bkmode = GetBkMode(hdc);
        got_bkmode = true;
        SetBkMode(hdc, TRANSPARENT);
        opaque = false;
    }

    if (got_bkmode)
        SetBkMode(hdc, bkmode);
}

int TermWinWindows::get_font_width(HDC hdc, const TEXTMETRIC *tm)
{
    int ret;
    /* Note that the TMPF_FIXED_PITCH bit is defined upside down :-( */
    if (!(tm->tmPitchAndFamily & TMPF_FIXED_PITCH)) {
        ret = tm->tmAveCharWidth;
    } else {
#define FIRST '0'
#define LAST '9'
        font_varpitch = true;
        font_dualwidth = true;

        ABCFLOAT widths[LAST-FIRST + 1];
        if (GetCharABCWidthsFloat(hdc, FIRST, LAST, widths)) {
            ret = 0;
            for (int j = 0; j < lenof(widths); j++) {
                int width = (int)(0.5 + widths[j].abcfA +
                                  widths[j].abcfB + widths[j].abcfC);
                if (ret < width)
                    ret = width;
            }
        } else {
            ret = tm->tmMaxCharWidth;
        }
#undef FIRST
#undef LAST
    }
    return ret;
}

void TermWinWindows::init_dpi_info()
{
    if (dpi_info.cur_dpi.x == 0 || dpi_info.cur_dpi.y == 0) {
        UINT dpiX, dpiY;
        HMONITOR currentMonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        if (GetDpiForMonitor(currentMonitor, MDT_EFFECTIVE_DPI,
                                &dpiX, &dpiY) == S_OK) {
            dpi_info.cur_dpi.x = (int)dpiX;
            dpi_info.cur_dpi.y = (int)dpiY;
        }

        /* Fall back to system DPI */
        if (dpi_info.cur_dpi.x == 0 || dpi_info.cur_dpi.y == 0) {
            HDC hdc = GetDC(hwnd);
            dpi_info.cur_dpi.x = GetDeviceCaps(hdc, LOGPIXELSX);
            dpi_info.cur_dpi.y = GetDeviceCaps(hdc, LOGPIXELSY);
            ReleaseDC(hwnd, hdc);
        }
    }
}

#define FONT_QUALITY(fq) ( \
    (fq) == FQ_DEFAULT ? DEFAULT_QUALITY : \
    (fq) == FQ_ANTIALIASED ? ANTIALIASED_QUALITY : \
    (fq) == FQ_NONANTIALIASED ? NONANTIALIASED_QUALITY : \
    CLEARTYPE_QUALITY)


/*
 * Initialize all the fonts we will need initially. There may be as many as
 * three or as few as one.  The other (potentially) twenty-one fonts are done
 * if/when they are needed.
 *
 * We also:
 *
 * - check the font width and height, correcting our guesses if
 *   necessary.
 *
 * - verify that the bold font is the same width as the ordinary
 *   one, and engage shadow bolding if not.
 *
 * - verify that the underlined font is the same width as the
 *   ordinary one (manual underlining by means of line drawing can
 *   be done in a pinch).
 */
void TermWinWindows::init_fonts(int pick_width, int pick_height)
{
    for(int i = 0; i < FONT_MAXNO; i++)
        fonts[i] = NULL;

    und_mode = UND_FONT;

    FontSpec font = conf->font;
    HDC hdc = GetDC(hwnd);

    if(pick_height)
        font_height = pick_height;
    else {
        font_height = font.height;
        if(font_height > 0)
            font_height = -MulDiv(font_height, dpi_info.cur_dpi.y, 72);
    }
    font_width = pick_width;

    // Create the normal and underline fonts in advance.
    create_font(FONT_NORMAL);
    create_font(FONT_UNDERLINE);

    TEXTMETRIC tm;
    SelectObject(hdc, fonts[FONT_NORMAL]);
    GetTextMetrics(hdc, &tm);

    OUTLINETEXTMETRIC otm;
    if (GetOutlineTextMetrics(hdc, sizeof(otm), &otm))
        font_strikethrough_y = tm.tmAscent - otm.otmsStrikeoutPosition;
    else
        font_strikethrough_y = tm.tmAscent - (tm.tmAscent * 3 / 8);

    GetObject(fonts[FONT_NORMAL], sizeof(LOGFONT), &lfont);

    /* Note that the TMPF_FIXED_PITCH bit is defined upside down :-( */
    if (!(tm.tmPitchAndFamily & TMPF_FIXED_PITCH)) {
        font_varpitch = false;
        font_dualwidth = (tm.tmAveCharWidth != tm.tmMaxCharWidth);
    } else {
        font_varpitch = true;
        font_dualwidth = true;
    }
    if (pick_width == 0 || pick_height == 0) {
        font_height = tm.tmHeight;
        font_width = get_font_width(hdc, &tm);
    }

    /*
     * Some fonts, e.g. 9-pt Courier, draw their underlines
     * outside their character cell. We successfully prevent
     * screen corruption by clipping the text output, but then
     * we lose the underline completely. Here we try to work
     * out whether this is such a font, and if it is, we set a
     * flag that causes underlines to be drawn by hand.
     *
     * Having tried other more sophisticated approaches (such
     * as examining the TEXTMETRIC structure or requesting the
     * height of a string), I think we'll do this the brute
     * force way: we create a small bitmap, draw an underlined
     * space on it, and test to see whether any pixels are
     * foreground-colored. (Since we expect the underline to
     * go all the way across the character cell, we only search
     * down a single column of the bitmap, half way across.)
     */
    {
        HDC und_dc;
        HBITMAP und_bm, und_oldbm;
        int i;
        bool gotit;
        COLORREF c;

        und_dc = CreateCompatibleDC(hdc);
        und_bm = CreateCompatibleBitmap(hdc, font_width, font_height);
        und_oldbm = (HBITMAP) SelectObject(und_dc, und_bm);
        SelectObject(und_dc, fonts[FONT_UNDERLINE]);
        SetTextAlign(und_dc, TA_TOP | TA_LEFT | TA_NOUPDATECP);
        SetTextColor(und_dc, RGB(255, 255, 255));
        SetBkColor(und_dc, RGB(0, 0, 0));
        SetBkMode(und_dc, OPAQUE);
        ExtTextOut(und_dc, 0, 0, ETO_OPAQUE, NULL, " ", 1, NULL);
        gotit = false;
        for (i = 0; i < font_height; i++) {
            c = GetPixel(und_dc, font_width / 2, i);
            if (c != RGB(0, 0, 0))
                gotit = true;
        }
        SelectObject(und_dc, und_oldbm);
        DeleteObject(und_bm);
        DeleteDC(und_dc);
        if (!gotit) {
            und_mode = UND_LINE;
            DeleteObject(fonts[FONT_UNDERLINE]);
            fonts[FONT_UNDERLINE] = 0;
        }
    }

    descent = tm.tmAscent + 1;
    if (descent >= font_height)
        descent = font_height - 1;

    int fontsize[3];
    for(int i = 0; i < 3; i++) {
        if (fonts[i]) {
            if (SelectObject(hdc, fonts[i]) && GetTextMetrics(hdc, &tm))
                fontsize[i] = get_font_width(hdc, &tm) + 256 * tm.tmHeight;
            else
                fontsize[i] = -i;
        } else
            fontsize[i] = -i;
    }

    ReleaseDC(hwnd, hdc);

    if (fontsize[FONT_UNDERLINE] != fontsize[FONT_NORMAL]) {
        und_mode = UND_LINE;
        DeleteObject(fonts[FONT_UNDERLINE]);
        fonts[FONT_UNDERLINE] = 0;
    }
}

void TermWinWindows::create_font(int fontno)
{
    if (fontno < 0 || fontno >= FONT_MAXNO)
        return;

    FontSpec font = conf->font;

    // If we're drawing bold and the font itself is already bold, draw heavy instead.
    int weight = FW_DONTCARE;
    if(fontno & FONT_BOLD)
        weight = font.isbold? FW_HEAVY:FW_BOLD;
    else
        weight = font.isbold?FW_BOLD:FW_DONTCARE;

    bool underline = (fontno & FONT_UNDERLINE) != 0;

    // FONT_WIDE means we're drawing a wide character but the font is actually narrow, so double its
    // width.  FONT_NARROW means the opposite.
    int actual_font_width = font_width;
    if (fontno & FONT_WIDE)
        actual_font_width *= 2;
    if (fontno & FONT_NARROW)
        actual_font_width = (actual_font_width+1)/2;

    // FONT_HIGH doubles the font height.
    int actual_font_height = font_height;
    if(fontno & FONT_HIGH)
        actual_font_height *= 2;

    fonts[fontno] = CreateFont(actual_font_height, actual_font_width, 0, 0,
        weight,
        false, underline, false, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS, FONT_QUALITY(conf->font_quality),
        FIXED_PITCH, font.name.c_str());
}

void TermWinWindows::deinit_fonts()
{
    int i;
    for (i = 0; i < FONT_MAXNO; i++) {
        if (fonts[i])
            DeleteObject(fonts[i]);
        fonts[i] = 0;
    }
}

void TermWinWindows::request_resize(int w, int h)
{
    int width, height;

    /* If the window is maximized suppress resizing attempts */
    if (IsZoomed(hwnd))
        return;

    if (h == term->rows && w == term->cols) return;

    // Sanity checks
    {
        RECT ss = get_fullscreen_rect();

        // Make sure the values are sane
        width = (ss.right - ss.left - extra_width) / 4;
        height = (ss.bottom - ss.top - extra_height) / 6;

        if (w > width || h > height)
            return;
        if (w < 15)
            w = 15;
        if (h < 1)
            h = 1;
    }

    if (!IsZoomed(hwnd)) {
        /*
         * We want to send exactly one term_size() to the terminal,
         * telling it what size it ended up after this operation.
         *
         * If we don't get the size we asked for in SetWindowPos, then
         * we'll be sent a WM_SIZE message, whose handler will make
         * that call, all before SetWindowPos even returns to here.
         *
         * But if that _didn't_ happen, we'll need to call term_size
         * ourselves afterwards.
         */
        sent_term_size = false;

        width = extra_width + font_width * w;
        height = extra_height + font_height * h;

        SetWindowPos(hwnd, NULL, 0, 0, width, height,
            SWP_NOACTIVATE | SWP_NOCOPYBITS |
            SWP_NOMOVE | SWP_NOZORDER);

        if (!sent_term_size)
            term->term_size(h, w, conf->savelines);
    } else {
        /*
         * If we're resizing by changing the font, we must tell the
         * terminal the new size immediately, so that reset_window
         * will know what to do.
         */
        term->term_size(h, w, conf->savelines);
        reset_window(0);
    }

    InvalidateRect(hwnd, NULL, true);
}

void TermWinWindows::recompute_window_offset()
{
    RECT cr;
    GetClientRect(hwnd, &cr);

    int win_width  = cr.right - cr.left;
    int win_height = cr.bottom - cr.top;

    int new_offset_width = (win_width-font_width*term->cols)/2;
    int new_offset_height = (win_height-font_height*term->rows)/2;

    if (offset_width != new_offset_width ||
        offset_height != new_offset_height) {
        offset_width = new_offset_width;
        offset_height = new_offset_height;
        InvalidateRect(hwnd, NULL, true);
    }
}

void TermWinWindows::reset_window(int reinit)
{
    /*
     * This function decides how to resize or redraw when the
     * user changes something.
     *
     * This function doesn't like to change the terminal size but if the
     * font size is locked that may be it's only soluion.
     */
    int win_width, win_height, window_border;
    RECT cr, wr;

    /* Current window sizes ... */
    GetWindowRect(hwnd, &wr);
    GetClientRect(hwnd, &cr);

    win_width  = cr.right - cr.left;
    win_height = cr.bottom - cr.top;

    window_border = conf->window_border;

    /* Are we being forced to reload the fonts ? */
    if (reinit>1) {
        deinit_fonts();
        init_fonts(0,0);
    }

    /* Oh, looks like we're minimized */
    if (win_width == 0 || win_height == 0)
        return;

    /* Is the window out of position? */
    if (!reinit) {
        recompute_window_offset();
    }

    if (IsZoomed(hwnd)) {
        /* We're fullscreen, this means we must not change the size of
         * the window so it's the font size or the terminal itself.
         */

        extra_width = wr.right - wr.left - cr.right + cr.left;
        extra_height = wr.bottom - wr.top - cr.bottom + cr.top;

        if (font_width * term->cols != win_width ||
            font_height * term->rows != win_height) {
            // Our only choice at this point is to change the
            // size of the terminal; Oh well.
            term->term_size(win_height/font_height, win_width/font_width, conf->savelines);
            offset_width = (win_width-font_width*term->cols)/2;
            offset_height = (win_height-font_height*term->rows)/2;
            InvalidateRect(hwnd, NULL, true);
        }
        return;
    }

    /* Resize window after DPI change */
    if (reinit == 3) {
        RECT rect;
        rect.left = rect.top = 0;
        rect.right = (font_width * term->cols);
        rect.right += GetSystemMetricsForDpi(SM_CXVSCROLL, dpi_info.cur_dpi.x);
        rect.bottom = (font_height * term->rows);
        AdjustWindowRectExForDpi(
            &rect, (DWORD) GetWindowLongPtr(hwnd, GWL_STYLE),
            FALSE, (DWORD) GetWindowLongPtr(hwnd, GWL_EXSTYLE),
            dpi_info.cur_dpi.x);
        rect.right += (window_border * 2);
        rect.bottom += (window_border * 2);
        OffsetRect(&dpi_info.new_wnd_rect,
            ((dpi_info.new_wnd_rect.right - dpi_info.new_wnd_rect.left) -
             (rect.right - rect.left)) / 2,
            ((dpi_info.new_wnd_rect.bottom - dpi_info.new_wnd_rect.top) -
             (rect.bottom - rect.top)) / 2);
        SetWindowPos(hwnd, NULL,
                     dpi_info.new_wnd_rect.left, dpi_info.new_wnd_rect.top,
                     rect.right - rect.left, rect.bottom - rect.top,
                     SWP_NOZORDER);

        InvalidateRect(hwnd, NULL, true);
        return;
    }

    /* Hmm, a force re-init means we should ignore the current window
     * so we resize to the default font size.
     */
    if (reinit>0) {
        offset_width = offset_height = window_border;
        extra_width = wr.right - wr.left - cr.right + cr.left + offset_width*2;
        extra_height = wr.bottom - wr.top - cr.bottom + cr.top +offset_height*2;

        if (win_width != font_width*term->cols + offset_width*2 ||
            win_height != font_height*term->rows + offset_height*2) {

            /* If this is too large windows will resize it to the maximum
             * allowed window size, we will then be back in here and resize
             * the font or terminal to fit.
             */
            SetWindowPos(hwnd, NULL, 0, 0,
                         font_width*term->cols + extra_width,
                         font_height*term->rows + extra_height,
                         SWP_NOMOVE | SWP_NOZORDER);
        }

        InvalidateRect(hwnd, NULL, true);
        return;
    }

    /* Okay the user doesn't want us to change the font so we try the
     * window. But that may be too big for the screen which forces us
     * to change the terminal.
     */
    {
        offset_width = offset_height = window_border;
        extra_width = wr.right - wr.left - cr.right + cr.left + offset_width*2;
        extra_height = wr.bottom - wr.top - cr.bottom + cr.top +offset_height*2;

        if (win_width != font_width*term->cols + offset_width*2 ||
            win_height != font_height*term->rows + offset_height*2) {

            RECT ss = get_fullscreen_rect();
            int width = (ss.right - ss.left - extra_width) / font_width;
            int height = (ss.bottom - ss.top - extra_height) / font_height;

            /* Grrr too big */
            if (term->rows > height || term->cols > width)
            {
                if ( height > term->rows ) height = term->rows;
                if ( width > term->cols )  width = term->cols;
                term->term_size(height, width, conf->savelines);
            }

            SetWindowPos(hwnd, NULL, 0, 0,
                         font_width*term->cols + extra_width,
                         font_height*term->rows + extra_height,
                         SWP_NOMOVE | SWP_NOZORDER);

            InvalidateRect(hwnd, NULL, true);
        }
        return;
    }

    /* We're allowed to or must change the font but do we want to ?  */

    if (font_width != (win_width-window_border*2)/term->cols ||
        font_height != (win_height-window_border*2)/term->rows) {

        deinit_fonts();
        init_fonts((win_width-window_border*2)/term->cols,
                   (win_height-window_border*2)/term->rows);
        offset_width = (win_width-font_width*term->cols)/2;
        offset_height = (win_height-font_height*term->rows)/2;

        extra_width = wr.right - wr.left - cr.right + cr.left +offset_width*2;
        extra_height = wr.bottom - wr.top - cr.bottom + cr.top+offset_height*2;

        InvalidateRect(hwnd, NULL, true);
    }
}

void TermWinWindows::set_input_locale(HKL kl)
{
    char lbuf[20];
    GetLocaleInfo(LOWORD(kl), LOCALE_IDEFAULTANSICODEPAGE, lbuf, sizeof(lbuf));

    kbd_codepage = atoi(lbuf);
}

void TermWinWindows::click(Mouse_Button b, int x, int y, bool shift, bool ctrl, bool alt)
{
    int thistime = GetMessageTime();

    if (send_raw_mouse && !shift) {
        lastbtn = MBT_NOTHING;
        term->term_mouse_action(b, translate_button(b), MA_CLICK, x, y, shift, ctrl, alt);
        return;
    }

    if (lastbtn == b && thistime - lasttime < dbltime) {
        lastact = (lastact == MA_CLICK ? MA_2CLK :
                   lastact == MA_2CLK ? MA_3CLK :
                   lastact == MA_3CLK ? MA_CLICK : MA_NOTHING);
    } else {
        lastbtn = b;
        lastact = MA_CLICK;
    }
    if (lastact != MA_NOTHING)
        term->term_mouse_action(b, translate_button(b), lastact, x, y, shift, ctrl, alt);
    lasttime = thistime;
}

/*
 * Translate a raw mouse button designation (LEFT, MIDDLE, RIGHT)
 * into a cooked one (SELECT, EXTEND, PASTE).
 */
Mouse_Button TermWinWindows::translate_button(Mouse_Button button)
{
    if (button == MBT_LEFT)
        return MBT_SELECT;
    if (button == MBT_MIDDLE)
        return MBT_PASTE;
    if (button == MBT_RIGHT)
        return MBT_EXTEND;
    return MBT_NOTHING;                          /* shouldn't happen */
}

static bool is_alt_pressed(void)
{
    BYTE keystate[256];
    int r = GetKeyboardState(keystate);
    if (!r)
        return false;
    if (keystate[VK_MENU] & 0x80)
        return true;
    if (keystate[VK_RMENU] & 0x80)
        return true;
    return false;
}

void TermWinWindows::timer_change(unsigned long next)
{
    unsigned long now = GetTickCount();
    long ticks;
    if (now - next < INT_MAX)
        ticks = 0;
    else
        ticks = next - now;

    KillTimer(hwnd, TIMING_TIMER_ID);
    SetTimer(hwnd, TIMING_TIMER_ID, ticks, NULL);
    timing_next_time = next;
}

HDC TermWinWindows::make_hdc()
{
    HDC hdc;

    if (!hwnd)
        return NULL;

    hdc = GetDC(hwnd);
    if (!hdc)
        return NULL;

    SelectPalette(hdc, pal, false);
    return hdc;
}

void TermWinWindows::free_hdc(HDC hdc)
{
    assert(hwnd);
    SelectPalette(hdc, HPALETTE(GetStockObject(DEFAULT_PALETTE)), false);
    ReleaseDC(hwnd, hdc);
}

static bool need_backend_resize = false;

void TermWinWindows::wm_size_resize_term(LPARAM lParam, bool border)
{
    int width = LOWORD(lParam);
    int height = HIWORD(lParam);
    int border_size = border ? conf->window_border : 0;

    int w = (width - border_size*2) / font_width;
    int h = (height - border_size*2) / font_height;

    if (w < 1) w = 1;
    if (h < 1) h = 1;

    if (resizing) {
        /*
         * If we're in the middle of an interactive resize, we don't
         * call term_size. This means that, firstly, the user can drag
         * the size back and forth indecisively without wiping out any
         * actual terminal contents, and secondly, the Terminal
         * doesn't call back->size in turn for each increment of the
         * resizing drag, so we don't spam the server with huge
         * numbers of resize events.
         */
        need_backend_resize = true;
        conf->height = h;
        conf->width = w;
    } else {
        term->term_size(h, w, conf->savelines);

        /* If this is happening re-entrantly during the call to
         * SetWindowPos in wintw_request_resize, let it know that
         * we've already done a term_size() so that it doesn't have
         * to. */
        sent_term_size = true;
    }
}

LRESULT CALLBACK TermWinWindows::WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    HDC hdc;
    static bool ignore_clip = false;
    static bool fullscr_on_max = false;
    static bool in_scrollbar_loop = false;
    static UINT last_mousemove = 0;

    switch (message) {
    case WM_TIMER:
        if ((UINT_PTR)wParam == TIMING_TIMER_ID) {
            unsigned long next;

            KillTimer(hwnd, TIMING_TIMER_ID);
            if (run_timers(timing_next_time, &next)) {
                timer_change(next);
            }
        }
        return 0;

    case WM_CLOSE:
        // Tell the application that the user wants to close the window.
        send_vvterm_event(VVTermEvent_Close);
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;

    case WM_COMMAND:
    case WM_SYSCOMMAND:
        switch (wParam & ~0xF) {       /* low 4 bits reserved to Windows */
        case SC_VSCROLL:
        case SC_HSCROLL:
            if (message == WM_SYSCOMMAND) {
                /* As per the long comment in WM_VSCROLL handler: give
                 * this message the default handling, which starts a
                 * subsidiary message loop, but set a flag so that
                 * when we're re-entered from that loop, scroll events
                 * within an interactive scrollbar-drag can be handled
                 * differently. */
                in_scrollbar_loop = true;
                LRESULT result = DefWindowProcW(hwnd, message, wParam, lParam);
                in_scrollbar_loop = false;
                return result;
            }
            break;
        case SC_KEYMENU:
            /*
             * We get this if the System menu has been activated
             * using the keyboard. This might happen from within
             * TranslateKey, in which case it really wants to be
             * followed by a `space' character to actually _bring
             * the menu up_ rather than just sitting there in
             * `ready to appear' state.
             */
            if( lParam == 0 )
                PostMessage(hwnd, WM_CHAR, ' ', 0);
            break;
        }
        break;

#define X_POS(l) ((int)(short)LOWORD(l))
#define Y_POS(l) ((int)(short)HIWORD(l))

#define TO_CHR_X(x) ((((x)<0 ? (x)-font_width+1 : (x))-offset_width) / font_width)
#define TO_CHR_Y(y) ((((y)<0 ? (y)-font_height+1: (y))-offset_height) / font_height)
    case WM_LBUTTONDOWN:
    case WM_MBUTTONDOWN:
    case WM_RBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_MBUTTONUP:
    case WM_RBUTTONUP:
    {
        Mouse_Button button;
        bool press;

        switch (message) {
        case WM_LBUTTONDOWN:  button = MBT_LEFT;    wParam |=  MK_LBUTTON; press = true; break;
        case WM_MBUTTONDOWN:  button = MBT_MIDDLE;  wParam |=  MK_MBUTTON; press = true; break;
        case WM_RBUTTONDOWN:  button = MBT_RIGHT;   wParam |=  MK_RBUTTON; press = true; break;
        case WM_LBUTTONUP:    button = MBT_LEFT;    wParam &= ~MK_LBUTTON; press = false; break;
        case WM_MBUTTONUP:    button = MBT_MIDDLE;  wParam &= ~MK_MBUTTON; press = false; break;
        case WM_RBUTTONUP:    button = MBT_RIGHT;   wParam &= ~MK_RBUTTON; press = false; break;
        default: /* shouldn't happen */ button = MBT_NOTHING; press = false; break;
        }

        if (press) {
            click(button,
                TO_CHR_X(X_POS(lParam)), TO_CHR_Y(Y_POS(lParam)),
                wParam & MK_SHIFT, wParam & MK_CONTROL,
                is_alt_pressed());
            SetCapture(hwnd);
        } else {
            term->term_mouse_action(button, translate_button(button), MA_RELEASE,
                TO_CHR_X(X_POS(lParam)),
                TO_CHR_Y(Y_POS(lParam)), wParam & MK_SHIFT,
                wParam & MK_CONTROL, is_alt_pressed());
            if (!(wParam & (MK_LBUTTON | MK_MBUTTON | MK_RBUTTON)))
                ReleaseCapture();
        }
        return 0;
    }
    case WM_MOUSEMOVE: {
        // Windows seems to like to occasionally send MOUSEMOVE events even if the mouse
        // hasn't moved. Don't unhide the mouse pointer in this case.
        static WPARAM wp = 0;
        static LPARAM lp = 0;
        if (wParam != wp || lParam != lp || last_mousemove != WM_MOUSEMOVE) {
            wp = wParam; lp = lParam;
            last_mousemove = WM_MOUSEMOVE;
        }

        if (wParam & (MK_LBUTTON | MK_MBUTTON | MK_RBUTTON) &&
            GetCapture() == hwnd) {
            Mouse_Button b;
            if (wParam & MK_LBUTTON)       b = MBT_LEFT;
            else if (wParam & MK_MBUTTON)  b = MBT_MIDDLE;
            else                           b = MBT_RIGHT;
            term->term_mouse_action(b, translate_button(b), MA_DRAG,
                TO_CHR_X(X_POS(lParam)), TO_CHR_Y(Y_POS(lParam)),
                wParam & MK_SHIFT,
                wParam & MK_CONTROL, is_alt_pressed());
        }
        return 0;
    }
    case WM_NCMOUSEMOVE: {
        static WPARAM wp = 0;
        static LPARAM lp = 0;
        if (wParam != wp || lParam != lp || last_mousemove != WM_NCMOUSEMOVE) {
            wp = wParam; lp = lParam;
            last_mousemove = WM_NCMOUSEMOVE;
        }
        break;
    }
    case WM_DESTROYCLIPBOARD:
        if (!ignore_clip)
            term->term_lost_clipboard_ownership();
        ignore_clip = false;
        return 0;
    case WM_PAINT: {
        PAINTSTRUCT p;

        HideCaret(hwnd);
        hdc = BeginPaint(hwnd, &p);
        if (pal) {
            SelectPalette(hdc, pal, true);
            RealizePalette(hdc);
        }

        // We have to be careful about term_paint(). It will set a bunch of character cells to INVALID and then
        // call do_paint(), which will redraw those cells and _then mark them as done_. This may not be accurate:
        // when painting in WM_PAINT context we are restricted to the rectangle which has just been exposed - so
        // if that only covers _part_ of a character cell and the rest of it was already visible, that remainder
        // will not be redrawn at all. Accordingly, we must not paint any character cell in a WM_PAINT context
        // which already has a pending update due to terminal output.  The simplest solution to this - and many,
        // many thanks to Hung-Te Lin for working all this out - is not to do any actual painting at _all_ if
        // there's a pending terminal update: just mark the relevant character cells as INVALID and wait for the
        // scheduled full update to sort it out.
        //
        // I have a suspicion this isn't the _right_ solution.  An alternative approach would be to have terminal.c
        // separately track what _should_ be on the terminal screen and what _is_ on the terminal screen, and
        // have two completely different types of redraw (one for full updates, which syncs the former with the
        // terminal itself, and one for WM_PAINT which syncs the latter with the former); yet another possibility
        // would be to have the Windows front end do what the GTK one already does, and maintain a bitmap of the
        // current terminal appearance so that WM_PAINT becomes completely trivial. However, this should do for now.
        assert(!wintw_hdc);
        wintw_hdc = hdc;
        term->term_paint(
            (p.rcPaint.left-offset_width)/font_width,
            (p.rcPaint.top-offset_height)/font_height,
            (p.rcPaint.right-offset_width-1)/font_width,
            (p.rcPaint.bottom-offset_height-1)/font_height,
            !term->window_update_pending);
        wintw_hdc = NULL;

        if (p.fErase ||
            p.rcPaint.left  < offset_width  ||
            p.rcPaint.top   < offset_height ||
            p.rcPaint.right >= offset_width + font_width*term->cols ||
            p.rcPaint.bottom>= offset_height + font_height*term->rows)
        {
            HBRUSH fillcolor = (HBRUSH) CreateSolidBrush(colors[ATTR_DEFBG>>ATTR_BGSHIFT]);
            HBRUSH oldbrush = (HBRUSH) SelectObject(hdc, fillcolor);
            HPEN edge = (HPEN) CreatePen(PS_SOLID, 0, colors[ATTR_DEFBG>>ATTR_BGSHIFT]);
            HPEN oldpen = (HPEN) SelectObject(hdc, edge);

            IntersectClipRect(hdc, p.rcPaint.left, p.rcPaint.top, p.rcPaint.right, p.rcPaint.bottom);
            ExcludeClipRect(hdc, offset_width, offset_height, offset_width+font_width*term->cols, offset_height+font_height*term->rows);
            Rectangle(hdc, p.rcPaint.left, p.rcPaint.top, p.rcPaint.right, p.rcPaint.bottom);

            // SelectClipRgn(hdc, NULL);
            SelectObject(hdc, oldbrush);
            DeleteObject(fillcolor);
            SelectObject(hdc, oldpen);
            DeleteObject(edge);
        }
        SelectObject(hdc, GetStockObject(SYSTEM_FONT));
        SelectObject(hdc, GetStockObject(WHITE_PEN));
        EndPaint(hwnd, &p);
        ShowCaret(hwnd);
        return 0;
    }
    case WM_SETFOCUS:
        term->term_set_focus(true);
        CreateCaret(hwnd, caretbm, font_width, font_height);
        ShowCaret(hwnd);
        compose_state = 0;
        term->term_update();
        break;
    case WM_KILLFOCUS:
        term->term_set_focus(false);
        DestroyCaret();
        caret_x = caret_y = -1;        // ensure caret is replaced next time
        term->term_update();
        break;
    case WM_ENTERSIZEMOVE:
        resizing = true;
        need_backend_resize = false;
        break;
    case WM_EXITSIZEMOVE:
        resizing = false;
        if (need_backend_resize) {
            term->term_size(conf->height, conf->width, conf->savelines);
            InvalidateRect(hwnd, NULL, true);
        }
        recompute_window_offset();
        break;
    case WM_SIZING:
    {
        //  Make sure the window size is stepped in units of the font size.
        int width, height, w, h, ew, eh;
        LPRECT r = (LPRECT) lParam;

        width = r->right - r->left - extra_width;
        height = r->bottom - r->top - extra_height;
        w = (width + font_width / 2) / font_width;
        if (w < 1)
            w = 1;
        h = (height + font_height / 2) / font_height;
        if (h < 1)
            h = 1;
        ew = width - w * font_width;
        eh = height - h * font_height;
        if (ew != 0) {
            if (wParam == WMSZ_LEFT ||
                wParam == WMSZ_BOTTOMLEFT || wParam == WMSZ_TOPLEFT)
                r->left += ew;
            else
                r->right -= ew;
        }
        if (eh != 0) {
            if (wParam == WMSZ_TOP ||
                wParam == WMSZ_TOPRIGHT || wParam == WMSZ_TOPLEFT)
                r->top += eh;
            else
                r->bottom -= eh;
        }
        return ew || eh;
    }
    case WM_MOVE:
        sys_cursor_update();
        break;
    case WM_SIZE:
        term->term_notify_minimized(wParam == SIZE_MINIMIZED);
        SetWindowTextW(hwnd, utf8_to_wstring(window_name).c_str());

        if (wParam == SIZE_MAXIMIZED) {
            was_zoomed = true;
            prev_rows = term->rows;
            prev_cols = term->cols;
            wm_size_resize_term(lParam, false);
            reset_window(0);
        } else if (wParam == SIZE_RESTORED && was_zoomed) {
            was_zoomed = false;
            wm_size_resize_term(lParam, true);
            reset_window(2);
        } else if (wParam == SIZE_MINIMIZED) {
            // Let the user know that the window was maximized.
            send_vvterm_event(VVTermEvent_Minimized);
        } else {
            wm_size_resize_term(lParam, true);

            // Sometimes, we can get a spontaneous resize event
            // outside a WM_SIZING interactive drag which wants to
            // set us to a new specific SIZE_RESTORED size. An
            // example is what happens if you press Windows+Right
            // and then Windows+Up: the first operation fits the
            // window to the right-hand half of the screen, and
            // the second one changes that for the top right
            // quadrant. In that situation, if we've responded
            // here by resizing the terminal, we may still need to
            // recompute the border around the window and do a
            // full redraw to clear the new border.
            if (!resizing)
                recompute_window_offset();
        }
        sys_cursor_update();
        return 0;
    case WM_DPICHANGED:
        dpi_info.cur_dpi.x = LOWORD(wParam);
        dpi_info.cur_dpi.y = HIWORD(wParam);
        dpi_info.new_wnd_rect = *(RECT*)(lParam);
        reset_window(3);
        return 0;
    case WM_VSCROLL:
        switch (LOWORD(wParam)) {
        case SB_BOTTOM:     term->term_scroll(-1, 0); break;
        case SB_TOP:        term->term_scroll(+1, 0); break;
        case SB_LINEDOWN:   term->term_scroll(0, +1); break;
        case SB_LINEUP:     term->term_scroll(0, -1); break;
        case SB_PAGEDOWN:   term->term_scroll(0, +term->rows / 2); break;
        case SB_PAGEUP:     term->term_scroll(0, -term->rows / 2); break;
        case SB_THUMBPOSITION:
        case SB_THUMBTRACK:
        {
            // Use GetScrollInfo instead of HIWORD(wParam) to get
            // 32-bit scroll position.
            SCROLLINFO si;

            si.cbSize = sizeof(si);
            si.fMask = SIF_TRACKPOS;
            if (GetScrollInfo(hwnd, SB_VERT, &si) == 0)
                si.nTrackPos = HIWORD(wParam);
            term->term_scroll(1, si.nTrackPos);
            break;
        }
        }

        if (in_scrollbar_loop)
        {
            // Allow window updates to happen during interactive scroll.
            //
            // When the user takes hold of our window's scrollbar and wobbles it interactively back
            // and forth, or presses on one of the arrow buttons at the ends, the first thing that
            // happens is that this window procedure receives WM_SYSCOMMAND / SC_VSCROLL. [1] The
            // default handler for that window message starts a subsidiary message loop, which
            // continues to run until the user lets go of the scrollbar again. All WM_VSCROLL / SB_THUMBTRACK
            // messages are generated by the handlers within that subsidiary message loop.
            //
            // So, during that time, _our_ message loop is not running, which means toplevel
            // callbacks and timers and so forth are not happening, which means that when we redraw
            // the window and set a timer to clear the cooldown flag 20ms later, that timer never
            // fires, and we aren't able to keep redrawing the window.
            //
            // The 'obvious' answer would be to seize that SYSCOMMAND ourselves and inhibit the
            // default handler, so that our message loop carries on running. But that would mean
            // we'd have to reimplement the whole of the scrollbar handler!
            //
            // So instead we apply a bodge: set a static variable that indicates that we're _in_
            // that sub-loop, and if so, decide it's OK to manually call term_update() proper,
            // bypassing the timer and cooldown and rate-limiting systems completely, whenever
            // we see an SB_THUMBTRACK.  This shouldn't cause a rate overload, because we're
            // only doing it once per UI event!
            //
            // [1] Actually, there's an extra oddity where SC_HSCROLL and SC_VSCROLL have their
            // documented values the wrong way round. Many people on the Internet have noticed
            // this, e.g. https://stackoverflow.com/q/55528397
            term->term_update();
        }
        break;
    case WM_PALETTECHANGED:
        if ((HWND) wParam != hwnd && pal != NULL) {
            HDC hdc = make_hdc();
            if (hdc) {
                if (RealizePalette(hdc) > 0)
                    UpdateColors(hdc);
                free_hdc(hdc);
            }
        }
        break;
    case WM_QUERYNEWPALETTE:
        if (pal != NULL) {
            HDC hdc = make_hdc();
            if (hdc) {
                if (RealizePalette(hdc) > 0)
                    UpdateColors(hdc);
                free_hdc(hdc);
                return true;
            }
        }
        return false;
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
    case WM_KEYUP:
    case WM_SYSKEYUP:
    {
        // We don't do TranslateMessage since it disassociates the
        // resulting CHAR message from the KEYDOWN that sparked it,
        // which we occasionally don't want. Instead, we process
        // KEYDOWN, and call the Win32 translator functions so that
        // we get the translations under _our_ control.
        unsigned char buf[20];
        int len;

        if (wParam == VK_PROCESSKEY || /* IME PROCESS key */
            wParam == VK_PACKET) {     /* 'this key is a Unicode char' */
            if (message == WM_KEYDOWN) {
                MSG m;
                m.hwnd = hwnd;
                m.message = WM_KEYDOWN;
                m.wParam = wParam;
                m.lParam = lParam & 0xdfff;
                TranslateMessage(&m);
            } else break; /* pass to Windows for default processing */
        } else {
            len = TranslateKey(message, wParam, lParam, buf);
            if (len == -1)
                return DefWindowProcW(hwnd, message, wParam, lParam);

            if (len != 0)
                term->term_keyinput(-1, (char *) buf, len);
        }
        return 0;
    }
    case WM_INPUTLANGCHANGE:
        // wParam == Font number
        // lParam == Locale
        set_input_locale((HKL)lParam);
        sys_cursor_update();
        break;
    case WM_IME_STARTCOMPOSITION: {
        HIMC hImc = ImmGetContext(hwnd);
        ImmSetCompositionFont(hImc, &lfont);
        ImmReleaseContext(hwnd, hImc);
        break;
    }
    case WM_IME_COMPOSITION: {
        HIMC hIMC;

        if ((lParam & GCS_RESULTSTR) == 0) /* Composition unfinished. */
            break; /* fall back to DefWindowProc */

        hIMC = ImmGetContext(hwnd);

        // beware: ImmGetCompositionStringW takes bytes when it should take number of wchar_t's
        int n = ImmGetCompositionStringW(hIMC, GCS_RESULTSTR, NULL, 0);

        if (n > 0) {
            int i;
            wstring buff(n/2, 0);
            ImmGetCompositionStringW(hIMC, GCS_RESULTSTR, buff.data(), n);

            // Jaeyoun Chung reports that Korean character
            // input doesn't work correctly if we do a single
            // term_keyinputw covering the whole of buff. So
            // instead we send the characters one by one.
            // don't divide SURROGATE PAIR
            if (backend) {
                for (i = 0; i < n; i += 2) {
                    WCHAR hs = buff[i];
                    if (IS_HIGH_SURROGATE(hs) && i+2 < n) {
                        WCHAR ls = buff[i+2];
                        if (IS_LOW_SURROGATE(ls)) {
                            term->term_keyinputw(&buff[i], 2);
                            i += 2;
                            continue;
                        }
                    }
                    term->term_keyinputw(&buff[i], 1);
                }
            }
        }
        ImmReleaseContext(hwnd, hIMC);
        return 1;
    }

    case WM_IME_CHAR:
        if (wParam & 0xFF00) {
            char buf[2];

            buf[1] = char(wParam);
            buf[0] = char(wParam >> 8);
            term->term_keyinput(kbd_codepage, buf, 2);
        } else {
            char c = (char) wParam;
            term->term_keyinput(kbd_codepage, &c, 1);
        }
        return 0;

    case WM_CHAR:
    case WM_SYSCHAR:
    {
        // Nevertheless, we are prepared to deal with WM_CHAR
        // messages, should they crop up. So if someone wants to
        // post the things to us as part of a macro manoeuvre,
        // we're ready to cope.
        static wchar_t pending_surrogate = 0;
        wchar_t c = wchar_t(wParam);

        if (IS_HIGH_SURROGATE(c)) {
            pending_surrogate = c;
        } else if (IS_SURROGATE_PAIR(pending_surrogate, c)) {
            wchar_t pair[2];
            pair[0] = pending_surrogate;
            pair[1] = c;
            term->term_keyinputw(pair, 2);
        } else if (!IS_SURROGATE(c)) {
            term->term_keyinputw(&c, 1);
        }
        return 0;
    }
    case WM_MOUSEWHEEL:
    {
        bool shift_pressed = false, control_pressed = false;

        if (message == WM_MOUSEWHEEL) {
            wheel_accumulator += (short)HIWORD(wParam);
            shift_pressed=LOWORD(wParam) & MK_SHIFT;
            control_pressed=LOWORD(wParam) & MK_CONTROL;
        } else {
            BYTE keys[256];
            wheel_accumulator += (int)wParam;
            if (GetKeyboardState(keys)!=0) {
                shift_pressed=keys[VK_SHIFT]&0x80;
                control_pressed=keys[VK_CONTROL]&0x80;
            }
        }

        //* process events when the threshold is reached
        while (abs(wheel_accumulator) >= WHEEL_DELTA) {
            Mouse_Button b;

            /* reduce amount for next time */
            if (wheel_accumulator > 0) {
                b = MBT_WHEEL_UP;
                wheel_accumulator -= WHEEL_DELTA;
            } else if (wheel_accumulator < 0) {
                b = MBT_WHEEL_DOWN;
                wheel_accumulator += WHEEL_DELTA;
            } else
                break;

            if (send_raw_mouse && !shift_pressed) {
                /* Mouse wheel position is in screen coordinates for
                * some reason */
                POINT p;
                p.x = X_POS(lParam); p.y = Y_POS(lParam);
                if (ScreenToClient(hwnd, &p)) {
                    /* send a mouse-down followed by a mouse up */
                    term->term_mouse_action(b, translate_button(b),
                        MA_CLICK,
                        TO_CHR_X(p.x),
                        TO_CHR_Y(p.y), shift_pressed,
                        control_pressed, is_alt_pressed());
                } /* else: not sure when this can fail */
            } else {
                /* trigger a scroll */
                term->term_scroll(0, b == MBT_WHEEL_UP ? -term->rows / 2 : term->rows / 2);
            }
            return 0;
        }
    }
    case WM_APP_IGNORE_CLIP:
        ignore_clip = wParam;          // don't panic on DESTROYCLIPBOARD
        break;

    case WM_APP_TIMER_CHANGE:
        timer_change((unsigned long) wParam);
        return 1;

    case WM_APP_SET_VISIBLE:
        ShowWindow(hwnd, wParam? SW_RESTORE:SW_HIDE);
        return 1;

    case WM_APP_GET_VISIBLE:
    {
        bool *result = (bool *) lParam;
        LONG style = GetWindowLong(hwnd, GWL_STYLE);
        *result = style & WS_VISIBLE;
        return 1;
    }

    case WM_APP_GET_HANDLES:
    {
        GetHandles *result = (GetHandles *) lParam;

        HANDLE input, output;
        backend->get_handles(&input, &output);

        *result->events = vvterm_event_handle->h;

        // Duplicate the handles, so they're independant of ours.  It's the caller's
        // responsibility to destroy these when it's done.
        DuplicateHandle(GetCurrentProcess(), vvterm_event_handle->h, GetCurrentProcess(), result->events, 0, FALSE, DUPLICATE_SAME_ACCESS);
        DuplicateHandle(GetCurrentProcess(), input, GetCurrentProcess(), result->input, 0, FALSE, DUPLICATE_SAME_ACCESS);
        DuplicateHandle(GetCurrentProcess(), output, GetCurrentProcess(), result->output, 0, FALSE, DUPLICATE_SAME_ACCESS);

        return 1;
    }

    // Return the next API event from the queue, or VVTermEvent_None if none.
    case WM_APP_GET_NEXT_EVENT:
    {
        auto *result = (VVTermEvent *) lParam;
        *result = vvterm_event_pop();
        return 1;
    }

    case WM_APP_SHUTDOWN:
        // The application wants us to shut down.  Destroy the window.  This
        // will post WM_DESTROY, which will post WM_QUIT and cause run() to
        // exit.
        DestroyWindow(hwnd);
        return 1;
    }

    return DefWindowProcW(hwnd, message, wParam, lParam);
}

// Queue an event that the caller can retrieve with get_next_event.
void TermWinWindows::send_vvterm_event(VVTermEvent event)
{
    vvterm_events.push_back(event);

    // Signal the event handle to let the user know there's an event waiting.
    SetEvent(vvterm_event_handle->h);
}

/*
 * Move the system caret. (We maintain one, even though it's
 * invisible, for the benefit of blind people: apparently some
 * helper software tracks the system caret, so we should arrange to
 * have one.)
 */
void TermWinWindows::set_cursor_pos(int x, int y)
{
    int cx, cy;

    if(!term->has_focus)
        return;

    /*
     * Avoid gratuitously re-updating the cursor position and IMM
     * window if there's no actual change required.
     */
    cx = x * font_width + offset_width;
    cy = y * font_height + offset_height;
    if (cx == caret_x && cy == caret_y)
        return;
    caret_x = cx;
    caret_y = cy;

    sys_cursor_update();
}

void TermWinWindows::sys_cursor_update()
{
    COMPOSITIONFORM cf;
    HIMC hIMC;

    if(!term->has_focus)
        return;

    if (caret_x < 0 || caret_y < 0)
        return;

    SetCaretPos(caret_x, caret_y);

    /* we should have the IMM functions */
    hIMC = ImmGetContext(hwnd);
    cf.dwStyle = CFS_POINT;
    cf.ptCurrentPos.x = caret_x;
    cf.ptCurrentPos.y = caret_y;
    ImmSetCompositionWindow(hIMC, &cf);

    ImmReleaseContext(hwnd, hIMC);
}

void TermWinWindows::draw_horizontal_line_on_text(int y, int lattr, RECT line_box, COLORREF color)
{
    if (lattr == LATTR_TOP || lattr == LATTR_BOT) {
        y *= 2;
        if (lattr == LATTR_BOT)
            y -= font_height;
    }

    if (!(0 <= y && y < font_height))
        return;

    HPEN oldpen = (HPEN) SelectObject(wintw_hdc, CreatePen(PS_SOLID, 0, color));
    MoveToEx(wintw_hdc, line_box.left, line_box.top + y, NULL);
    LineTo(wintw_hdc, line_box.right, line_box.top + y);
    oldpen = (HPEN) SelectObject(wintw_hdc, oldpen);
    DeleteObject(oldpen);
}

/*
 * Draw a line of text in the window, at given character
 * coordinates, in given attributes.
 *
 * We are allowed to fiddle with the contents of `text'.
 */
void TermWinWindows::do_text_internal(
    int x, int y, wchar_t *text, int len,
    unsigned long attr, int lattr, truecolor truecolor)
{
    COLORREF fg, bg;
    RECT line_box;
    bool force_manual_underline = false;
    int fnt_width;
    int text_adjust = 0;
    int xoffset = 0;
    int maxlen, remaining;
    bool opaque;
    int len2; /* for SURROGATE PAIR */

    lattr &= LATTR_MODE;

    int char_width = fnt_width = font_width * (1 + (lattr != LATTR_NORM));
    if (attr & ATTR_WIDE)
        char_width *= 2;

    /* Only want the left half of double width lines */
    if (lattr != LATTR_NORM && x*2 >= term->cols)
        return;

    x *= fnt_width;
    y *= font_height;
    x += offset_width;
    y += offset_height;

    bool is_cursor = false;
    if (attr & TATTR_ACTCURS) {
        truecolor.fg = truecolor.bg = optionalrgb_none;
        attr &= ~(ATTR_REVERSE|ATTR_BLINK|ATTR_COLORS|ATTR_DIM);
        /* cursor fg and bg */
        attr |= (260 << ATTR_FGSHIFT) | (261 << ATTR_BGSHIFT);
        is_cursor = true;
    }

    int nfont = 0;
    switch (lattr) {
    case LATTR_NORM:
        break;
    case LATTR_WIDE:
        nfont |= FONT_WIDE;
        break;
    default:
        nfont |= FONT_WIDE + FONT_HIGH;
        break;
    }
    if (attr & ATTR_NARROW)
        nfont |= FONT_NARROW;

    int nfg = ((attr & ATTR_FGMASK) >> ATTR_FGSHIFT);
    int nbg = ((attr & ATTR_BGMASK) >> ATTR_BGSHIFT);
    if (und_mode == UND_FONT && (attr & ATTR_UNDER))
        nfont |= FONT_UNDERLINE;
    create_font(nfont);
    if (!fonts[nfont]) {
        // If this was an underline font and we couldn't load it, use manual underlining.
        if (nfont & FONT_UNDERLINE)
            force_manual_underline = true;

        // Don't do the same for manual bold, it could be bad news.
        nfont &= ~(FONT_BOLD | FONT_UNDERLINE);
    }

    create_font(nfont);

    // If we couldn't get this version of the font, just use the normal one.
    if (!fonts[nfont])
        nfont = FONT_NORMAL;

    if (attr & ATTR_REVERSE) {
        swap(nfg, nbg);
        swap(truecolor.fg, truecolor.bg);
    }
    if ((attr & ATTR_BOLD) && !is_cursor) {
        if (nfg < 16) nfg |= 8;
        else if (nfg >= 256) nfg |= 1;
    }
    if ((attr & ATTR_BLINK)) {
        if (nbg < 16) nbg |= 8;
        else if (nbg >= 256) nbg |= 1;
    }
    if (!pal && truecolor.fg.enabled)
        fg = RGB(truecolor.fg.r, truecolor.fg.g, truecolor.fg.b);
    else
        fg = colors[nfg];

    if (!pal && truecolor.bg.enabled)
        bg = RGB(truecolor.bg.r, truecolor.bg.g, truecolor.bg.b);
    else
        bg = colors[nbg];

    if (!pal && (attr & ATTR_DIM)) {
        fg = RGB(GetRValue(fg) * 2 / 3,
                 GetGValue(fg) * 2 / 3,
                 GetBValue(fg) * 2 / 3);
    }

    SelectObject(wintw_hdc, fonts[nfont]);
    SetTextColor(wintw_hdc, fg);
    SetBkColor(wintw_hdc, bg);
    if (attr & TATTR_COMBINING)
        SetBkMode(wintw_hdc, TRANSPARENT);
    else
        SetBkMode(wintw_hdc, OPAQUE);
    line_box.left = x;
    line_box.top = y;
    line_box.right = x + char_width * len;
    line_box.bottom = y + font_height;
    /* adjust line_box.right for SURROGATE PAIR & VARIATION SELECTOR */
    {
        int i;
        int rc_width = 0;
        for (i = 0; i < len ; i++) {
            if (i+1 < len && IS_HIGH_VARSEL(text[i], text[i+1])) {
                i++;
            } else if (i+1 < len && IS_SURROGATE_PAIR(text[i], text[i+1])) {
                rc_width += char_width;
                i++;
            } else if (IS_LOW_VARSEL(text[i])) {
                /* do nothing */
            } else {
                rc_width += char_width;
            }
        }
        line_box.right = line_box.left + rc_width;
    }

    /* Only want the left half of double width lines */
    if (line_box.right > font_width*term->cols+offset_width)
        line_box.right = font_width*term->cols+offset_width;

    bool use_lpdx = true;
    if (font_varpitch) {
        /*
         * If we're using a variable-pitch font, we unconditionally
         * draw the glyphs one at a time and centre them in their
         * character cells (which means in particular that we must
         * disable the lpDx mechanism). This gives slightly odd but
         * generally reasonable results.
         */
        xoffset = char_width / 2;
        SetTextAlign(wintw_hdc, TA_TOP | TA_CENTER | TA_NOUPDATECP);
        use_lpdx = false;
        maxlen = 1;
    } else {
        /*
         * In a fixed-pitch font, we draw the whole string in one go
         * in the normal way.
         */
        xoffset = 0;
        SetTextAlign(wintw_hdc, TA_TOP | TA_LEFT | TA_NOUPDATECP);
        use_lpdx = true;
        maxlen = len;
    }

    static vector<int> lpDx;

    opaque = true;                     /* start by erasing the rectangle */
    for (remaining = len; remaining > 0;
         text += len, remaining -= len, x += char_width * len2) {
        len = (maxlen < remaining ? maxlen : remaining);
        /* don't divide SURROGATE PAIR and VARIATION SELECTOR */
        len2 = len;
        if (maxlen == 1) {
            if (remaining >= 1 && IS_SURROGATE_PAIR(text[0], text[1]))
                len++;
            if (remaining-len >= 1 && IS_LOW_VARSEL(text[len]))
                len++;
            else if (remaining-len >= 2 &&
                     IS_HIGH_VARSEL(text[len], text[len+1]))
                len += 2;
        }

        if(len > lpDx.size())
            lpDx.resize(len);

        {
            int i;
            /* only last char has dx width in SURROGATE PAIR and
             * VARIATION sequence */
            for (i = 0; i < len; i++) {
                lpDx[i] = char_width;
                if (i+1 < len && IS_HIGH_VARSEL(text[i], text[i+1])) {
                    if (i > 0) lpDx[i-1] = 0;
                    lpDx[i] = 0;
                    i++;
                    lpDx[i] = char_width;
                } else if (i+1 < len && IS_SURROGATE_PAIR(text[i],text[i+1])) {
                    lpDx[i] = 0;
                    i++;
                    lpDx[i] = char_width;
                } else if (IS_LOW_VARSEL(text[i])) {
                    if (i > 0) lpDx[i-1] = 0;
                    lpDx[i] = char_width;
                }
            }
        }

        /* And 'normal' unicode characters */
        static wstring wbuf;

        if (wbuf.size() < len) {
            wbuf.resize(len);
        }

        for(int i = 0; i < len; i++)
            wbuf[i] = text[i];

        /* print Glyphs as they are, without Windows's Shaping*/
        general_textout(wintw_hdc, x + xoffset,
                        y - font_height * (lattr==LATTR_BOT) + text_adjust,
                        &line_box, wbuf.c_str(), len, lpDx.data(),
                        opaque && !(attr & TATTR_COMBINING));

        /*
         * If we're looping round again, stop erasing the background
         * rectangle.
         */
        SetBkMode(wintw_hdc, TRANSPARENT);
        opaque = false;
    }

    if (lattr != LATTR_TOP && (force_manual_underline ||
                               (und_mode == UND_LINE && (attr & ATTR_UNDER))))
        draw_horizontal_line_on_text(descent, lattr, line_box, fg);

    if (attr & ATTR_STRIKE)
        draw_horizontal_line_on_text(font_strikethrough_y, lattr, line_box, fg);
}

/*
 * Wrapper that handles combining characters.
 */
void TermWinWindows::draw_text(int x, int y, wchar_t *text, int len,
    unsigned long attr, int lattr, truecolor truecolor)
{
    if (attr & TATTR_COMBINING) {
        unsigned long a = 0;
        int len0 = 1;
        /* don't divide SURROGATE PAIR and VARIATION SELECTOR */
        if (len >= 2 && IS_SURROGATE_PAIR(text[0], text[1]))
            len0 = 2;
        if (len-len0 >= 1 && IS_LOW_VARSEL(text[len0])) {
            attr &= ~TATTR_COMBINING;
            do_text_internal(x, y, text, len0+1, attr, lattr, truecolor);
            text += len0+1;
            len -= len0+1;
            a = TATTR_COMBINING;
        } else if (len-len0 >= 2 && IS_HIGH_VARSEL(text[len0], text[len0+1])) {
            attr &= ~TATTR_COMBINING;
            do_text_internal(x, y, text, len0+2, attr, lattr, truecolor);
            text += len0+2;
            len -= len0+2;
            a = TATTR_COMBINING;
        } else {
            attr &= ~TATTR_COMBINING;
        }

        while (len--) {
            if (len >= 1 && IS_SURROGATE_PAIR(text[0], text[1])) {
                do_text_internal(x, y, text, 2, attr | a, lattr, truecolor);
                len--;
                text++;
            } else
                do_text_internal(x, y, text, 1, attr | a, lattr, truecolor);

            text++;
            a = TATTR_COMBINING;
        }
    } else
        do_text_internal(x, y, text, len, attr, lattr, truecolor);
}

void TermWinWindows::draw_cursor(int x, int y, wchar_t *text, int len,
    unsigned long attr, int lattr, truecolor truecolor)
{
    int fnt_width;
    int char_width;
    int ctype = 0;

    lattr &= LATTR_MODE;

    if (attr & TATTR_ACTCURS) {
        if (*text != UCSWIDE) {
            draw_text(x, y, text, len, attr, lattr, truecolor);
            return;
        }
        ctype = 2;
        attr |= TATTR_RIGHTCURS;
    }

    fnt_width = char_width = font_width * (1 + (lattr != LATTR_NORM));
    if (attr & ATTR_WIDE)
        char_width *= 2;
    x *= fnt_width;
    y *= font_height;
    x += offset_width;
    y += offset_height;

    if (attr & TATTR_PASCURS) {
        POINT pts[5];
        HPEN oldpen;
        pts[0].x = pts[1].x = pts[4].x = x;
        pts[2].x = pts[3].x = x + char_width - 1;
        pts[0].y = pts[3].y = pts[4].y = y;
        pts[1].y = pts[2].y = y + font_height - 1;
        oldpen = (HPEN) SelectObject(wintw_hdc, CreatePen(PS_SOLID, 0, colors[261]));
        Polyline(wintw_hdc, pts, 5);
        oldpen = (HPEN) SelectObject(wintw_hdc, oldpen);
        DeleteObject(oldpen);
    } else if ((attr & (TATTR_ACTCURS | TATTR_PASCURS)) && ctype != 0) {
        int startx, starty, dx, dy, length, i;
        if (ctype == 1) {
            startx = x;
            starty = y + descent;
            dx = 1;
            dy = 0;
            length = char_width;
        } else {
            int xadjust = 0;
            if (attr & TATTR_RIGHTCURS)
                xadjust = char_width - 1;
            startx = x + xadjust;
            starty = y;
            dx = 0;
            dy = 1;
            length = font_height;
        }
        if (attr & TATTR_ACTCURS) {
            HPEN oldpen = (HPEN) SelectObject(wintw_hdc, CreatePen(PS_SOLID, 0, colors[261]));
            MoveToEx(wintw_hdc, startx, starty, NULL);
            LineTo(wintw_hdc, startx + dx * length, starty + dy * length);
            oldpen = (HPEN) SelectObject(wintw_hdc, oldpen);
            DeleteObject(oldpen);
        } else {
            for (i = 0; i < length; i++) {
                if (i % 2 == 0) {
                    SetPixel(wintw_hdc, startx, starty, colors[261]);
                }
                startx += dx;
                starty += dy;
            }
        }
    }
}

/* This function gets the actual width of a character in the normal font.
 */
int TermWinWindows::get_char_width(int uc)
{
    int ibuf = 0;

    /* If the font max is the same as the font ave width then this
     * function is a no-op.
     */
    if (!font_dualwidth) return 1;

    /* Speedup, I know of no font where ascii is the wrong width */
    if (uc >= ' ' && uc <= '~') return 1;

    SelectObject(wintw_hdc, fonts[FONT_NORMAL]);
    if (GetCharWidth32W(wintw_hdc, uc, uc, &ibuf) == 1)
        /* Okay that one worked */ ;
    else if (GetCharWidthW(wintw_hdc, uc, uc, &ibuf) == 1)
        /* This should work on 9x too, but it's "less accurate" */ ;
    else
        return 0;

    ibuf += font_width / 2 -1;
    ibuf /= font_width;

    return ibuf;
}

/*
 * Translate a WM_(SYS)?KEY(UP|DOWN) message into a string of ASCII
 * codes. Returns number of bytes used, zero to drop the message,
 * -1 to forward the message to Windows, or another negative number
 * to indicate a NUL-terminated "special" string.
 */
int TermWinWindows::TranslateKey(UINT message, WPARAM wParam, LPARAM lParam, unsigned char *output)
{
    unsigned char *p = output;
    static int alt_sum = 0;

    HKL kbd_layout = GetKeyboardLayout(0);

    static wchar_t keys_unicode[3];
    static int compose_char = 0;
    static WPARAM compose_keycode = 0;

    BYTE keystate[256];
    int r = GetKeyboardState(keystate);
    if (!r)
        memset(keystate, 0, sizeof(keystate));
    else {
#if 0
#define SHOW_TOASCII_RESULT
        {                              /* Tell us all about key events */
            static BYTE oldstate[256];
            static int first = 1;
            static int scan;
            int ch;
            if (first)
                memcpy(oldstate, keystate, sizeof(oldstate));
            first = 0;

            if ((HIWORD(lParam) & (KF_UP | KF_REPEAT)) == KF_REPEAT) {
                debug("+");
            } else if ((HIWORD(lParam) & KF_UP)
                       && scan == (HIWORD(lParam) & 0xFF)) {
                debug(". U");
            } else {
                debug(".\n");
                if (wParam >= VK_F1 && wParam <= VK_F20)
                    debug("K_F%d", wParam + 1 - VK_F1);
                else
                    switch (wParam) {
                      case VK_SHIFT:
                        debug("SHIFT");
                        break;
                      case VK_CONTROL:
                        debug("CTRL");
                        break;
                      case VK_MENU:
                        debug("ALT");
                        break;
                      default:
                        debug("VK_%02x", wParam);
                    }
                if (message == WM_SYSKEYDOWN || message == WM_SYSKEYUP)
                    debug("*");
                debug(", S%02x", scan = (HIWORD(lParam) & 0xFF));

                ch = MapVirtualKeyEx(wParam, 2, kbd_layout);
                if (ch >= ' ' && ch <= '~')
                    debug(", '%c'", ch);
                else if (ch)
                    debug(", $%02x", ch);

                if (keys_unicode[0])
                    debug(", KB0=%04x", keys_unicode[0]);
                if (keys_unicode[1])
                    debug(", KB1=%04x", keys_unicode[1]);
                if (keys_unicode[2])
                    debug(", KB2=%04x", keys_unicode[2]);

                if ((keystate[VK_SHIFT] & 0x80) != 0)
                    debug(", S");
                if ((keystate[VK_CONTROL] & 0x80) != 0)
                    debug(", C");
                if ((HIWORD(lParam) & KF_EXTENDED))
                    debug(", E");
                if ((HIWORD(lParam) & KF_UP))
                    debug(", U");
            }

            if ((HIWORD(lParam) & (KF_UP | KF_REPEAT)) == KF_REPEAT);
            else if ((HIWORD(lParam) & KF_UP))
                oldstate[wParam & 0xFF] ^= 0x80;
            else
                oldstate[wParam & 0xFF] ^= 0x81;

            for (ch = 0; ch < 256; ch++)
                if (oldstate[ch] != keystate[ch])
                    debug(", M%02x=%02x", ch, keystate[ch]);

            memcpy(oldstate, keystate, sizeof(oldstate));
        }
#endif

        if (wParam == VK_MENU && (HIWORD(lParam) & KF_EXTENDED)) {
            keystate[VK_RMENU] = keystate[VK_MENU];
        }


        /* Nastiness with NUMLock - Shift-NUMLock is left alone though */
        if (term->app_keypad_keys && wParam == VK_NUMLOCK && !(keystate[VK_SHIFT] & 0x80))
        {
            wParam = VK_EXECUTE;

            /* UnToggle NUMLock */
            if ((HIWORD(lParam) & (KF_UP | KF_REPEAT)) == 0)
                keystate[VK_NUMLOCK] ^= 1;
        }

        /* And write back the 'adjusted' state */
        SetKeyboardState(keystate);
    }

    /* Disable Auto repeat if required */
    if (term->repeat_off &&
        (HIWORD(lParam) & (KF_UP | KF_REPEAT)) == KF_REPEAT)
        return 0;

    bool left_alt = false;
    if ((HIWORD(lParam) & KF_ALTDOWN) && (keystate[VK_RMENU] & 0x80) == 0)
        left_alt = true;

    bool key_down = ((HIWORD(lParam) & KF_UP) == 0);

    // Make sure Ctrl-ALT is not the same as AltGr for ToAscii
    if (left_alt && (keystate[VK_CONTROL] & 0x80)) {
        keystate[VK_MENU] = 0;
    }

    int scan = (HIWORD(lParam) & (KF_UP | KF_EXTENDED | 0xFF));
    int shift_state = ((keystate[VK_SHIFT] & 0x80) != 0)
        + ((keystate[VK_CONTROL] & 0x80) != 0) * 2;

    /* Note if AltGr was pressed and if it was used as a compose key */
    if (!compose_state) {
        compose_keycode = 0x100;
        if (wParam == VK_APPS)
            compose_keycode = wParam;
    }

    if (wParam == compose_keycode) {
        if (compose_state == 0
            && (HIWORD(lParam) & (KF_UP | KF_REPEAT)) == 0) compose_state =
                1;
        else if (compose_state == 1 && (HIWORD(lParam) & KF_UP))
            compose_state = 2;
        else
            compose_state = 0;
    } else if (compose_state == 1 && wParam != VK_CONTROL)
        compose_state = 0;

    if (compose_state > 1 && left_alt)
        compose_state = 0;

    /* Sanitize the number pad if not using a PC NumPad */
    if (left_alt || term->app_keypad_keys || compose_state)
    {
        if ((HIWORD(lParam) & KF_EXTENDED) == 0) {
            int nParam = 0;
            switch (wParam) {
            case VK_INSERT:    nParam = VK_NUMPAD0; break;
            case VK_END:       nParam = VK_NUMPAD1; break;
            case VK_DOWN:      nParam = VK_NUMPAD2; break;
            case VK_NEXT:      nParam = VK_NUMPAD3; break;
            case VK_LEFT:      nParam = VK_NUMPAD4; break;
            case VK_CLEAR:     nParam = VK_NUMPAD5; break;
            case VK_RIGHT:     nParam = VK_NUMPAD6; break;
            case VK_HOME:      nParam = VK_NUMPAD7; break;
            case VK_UP:        nParam = VK_NUMPAD8; break;
            case VK_PRIOR:     nParam = VK_NUMPAD9; break;
            case VK_DELETE:    nParam = VK_DECIMAL; break;
            }

            if (nParam) {
                if (keystate[VK_NUMLOCK] & 1)
                    shift_state |= 1;
                wParam = nParam;
            }
        }
    }

    /* If a key is pressed and AltGr is not active */
    if (key_down && (keystate[VK_RMENU] & 0x80) == 0 && !compose_state) {
        /* Okay, prepare for most alts then ... */
        if (left_alt)
            *p++ = '\033';

        /* Lets see if it's a pattern we know all about ... */
        if (wParam == VK_PRIOR && shift_state == 1) {
            SendMessage(hwnd, WM_VSCROLL, SB_PAGEUP, 0);
            return 0;
        }
        if (wParam == VK_PRIOR && shift_state == 3) { /* ctrl-shift-pageup */
            SendMessage(hwnd, WM_VSCROLL, SB_TOP, 0);
            return 0;
        }
        if (wParam == VK_NEXT && shift_state == 3) { /* ctrl-shift-pagedown */
            SendMessage(hwnd, WM_VSCROLL, SB_BOTTOM, 0);
            return 0;
        }

        if (wParam == VK_PRIOR && shift_state == 2) {
            SendMessage(hwnd, WM_VSCROLL, SB_LINEUP, 0);
            return 0;
        }
        if (wParam == VK_NEXT && shift_state == 1) {
            SendMessage(hwnd, WM_VSCROLL, SB_PAGEDOWN, 0);
            return 0;
        }
        if (wParam == VK_NEXT && shift_state == 2) {
            SendMessage(hwnd, WM_VSCROLL, SB_LINEDOWN, 0);
            return 0;
        }
        if ((wParam == VK_PRIOR || wParam == VK_NEXT) && shift_state == 3) {
            term->term_scroll_to_selection((wParam == VK_PRIOR ? 0 : 1));
            return 0;
        }
        if (wParam == VK_INSERT && shift_state == 1) {
            term->term_request_paste();
            return 0;
        }
        if (left_alt && wParam == VK_F4)
            return -1;
        if (left_alt && wParam == VK_SPACE) {
            SendMessage(hwnd, WM_SYSCOMMAND, SC_KEYMENU, 0);
            return -1;
        }
        /* Control-Numlock for app-keypad mode switch */
        if (wParam == VK_PAUSE && shift_state == 2) {
            term->app_keypad_keys = !term->app_keypad_keys;
            return 0;
        }

        if (wParam == VK_BACK && shift_state == 0) {    /* Backspace */
            *p++ = 0x7F;
            *p++ = 0;
            return -2;
        }
        if (wParam == VK_BACK && shift_state == 1) {    /* Shift Backspace */
            /* We do the opposite of what is configured */
            *p++ = 0x08;
            *p++ = 0;
            return -2;
        }
        if (wParam == VK_TAB && shift_state == 1) {     /* Shift tab */
            *p++ = 0x1B;
            *p++ = '[';
            *p++ = 'Z';
            return int(p - output);
        }
        if (wParam == VK_SPACE && shift_state == 2) {   /* Ctrl-Space */
            *p++ = 0;
            return int(p - output);
        }
        if (wParam == VK_SPACE && shift_state == 3) {   /* Ctrl-Shift-Space */
            *p++ = 160;
            return int(p - output);
        }
        if (wParam == VK_CANCEL && shift_state == 2) {  /* Ctrl-Break */
            if (backend)
                backend->special(SS_BRK, 0);
            return 0;
        }
        if (wParam == VK_PAUSE) {      /* Break/Pause */
            *p++ = 26;
            *p++ = 0;
            return -2;
        }
        /* Control-2 to Control-8 are special */
        if (shift_state == 2 && wParam >= '2' && wParam <= '8') {
            *p++ = "\000\033\034\035\036\037\177"[wParam - '2'];
            return int(p - output);
        }
        if (shift_state == 2 && (wParam == 0xBD || wParam == 0xBF)) {
            *p++ = 0x1F;
            return int(p - output);
        }
        if (shift_state == 2 && (wParam == 0xDF || wParam == 0xDC)) {
            *p++ = 0x1C;
            return int(p - output);
        }
        if (shift_state == 3 && wParam == 0xDE) {
            *p++ = 0x1E;               /* Ctrl-~ == Ctrl-^ in xterm at least */
            return int(p - output);
        }

        bool consumed_alt;
        char keypad_key = '\0';
        switch (wParam)
        {
        case VK_NUMPAD0: keypad_key = '0'; goto numeric_keypad;
        case VK_NUMPAD1: keypad_key = '1'; goto numeric_keypad;
        case VK_NUMPAD2: keypad_key = '2'; goto numeric_keypad;
        case VK_NUMPAD3: keypad_key = '3'; goto numeric_keypad;
        case VK_NUMPAD4: keypad_key = '4'; goto numeric_keypad;
        case VK_NUMPAD5: keypad_key = '5'; goto numeric_keypad;
        case VK_NUMPAD6: keypad_key = '6'; goto numeric_keypad;
        case VK_NUMPAD7: keypad_key = '7'; goto numeric_keypad;
        case VK_NUMPAD8: keypad_key = '8'; goto numeric_keypad;
        case VK_NUMPAD9: keypad_key = '9'; goto numeric_keypad;
        case VK_DECIMAL: keypad_key = '.'; goto numeric_keypad;
        case VK_ADD: keypad_key = '+'; goto numeric_keypad;
        case VK_SUBTRACT: keypad_key = '-'; goto numeric_keypad;
        case VK_MULTIPLY: keypad_key = '*'; goto numeric_keypad;
        case VK_DIVIDE: keypad_key = '/'; goto numeric_keypad;
        case VK_EXECUTE: keypad_key = 'G'; goto numeric_keypad;
            /* also the case for VK_RETURN below can sometimes come here */
        numeric_keypad:
            /* Left Alt overrides all numeric keypad usage to act as
             * numeric character code input */
            if (left_alt) {
                if (keypad_key >= '0' && keypad_key <= '9')
                    alt_sum = alt_sum * 10 + keypad_key - '0';
                else
                    alt_sum = 0;
                break;
            }

            {
                int nchars = format_numeric_keypad_key((char *)p, term.get(), keypad_key, shift_state & 1, shift_state & 2);
                if (!nchars)
                {
                    // If we didn't get an escape sequence out of the numeric keypad key,
                    // then that must be because we're in Num Lock mode without application
                    // keypad enabled. In that situation we leave this keypress to the
                    // ToUnicode/ToAsciiEx handler below, which will translate it according
                    // to the appropriate keypad layout (e.g. so that what a Brit thinks of
                    // as keypad '.' can become ',' in the German layout).
                    //
                    // An exception is the keypad Return key: if we didn't get an escape
                    // sequence for that, we treat it like ordinary Return, taking into
                    // account Telnet special new line codes and config options.
                    if (keypad_key == '\r')
                        goto ordinary_return_key;
                    break;
                }

                p += nchars;
                return int(p - output);
            }

            int fkey_number;
        case VK_F1: fkey_number = 1; goto numbered_function_key;
        case VK_F2: fkey_number = 2; goto numbered_function_key;
        case VK_F3: fkey_number = 3; goto numbered_function_key;
        case VK_F4: fkey_number = 4; goto numbered_function_key;
        case VK_F5: fkey_number = 5; goto numbered_function_key;
        case VK_F6: fkey_number = 6; goto numbered_function_key;
        case VK_F7: fkey_number = 7; goto numbered_function_key;
        case VK_F8: fkey_number = 8; goto numbered_function_key;
        case VK_F9: fkey_number = 9; goto numbered_function_key;
        case VK_F10: fkey_number = 10; goto numbered_function_key;
        case VK_F11: fkey_number = 11; goto numbered_function_key;
        case VK_F12: fkey_number = 12; goto numbered_function_key;
        case VK_F13: fkey_number = 13; goto numbered_function_key;
        case VK_F14: fkey_number = 14; goto numbered_function_key;
        case VK_F15: fkey_number = 15; goto numbered_function_key;
        case VK_F16: fkey_number = 16; goto numbered_function_key;
        case VK_F17: fkey_number = 17; goto numbered_function_key;
        case VK_F18: fkey_number = 18; goto numbered_function_key;
        case VK_F19: fkey_number = 19; goto numbered_function_key;
        case VK_F20: fkey_number = 20; goto numbered_function_key;
        numbered_function_key:
            consumed_alt = false;
            p += format_function_key((char *)p, term.get(), fkey_number, shift_state & 1, shift_state & 2, left_alt, &consumed_alt);
            if (consumed_alt)
                left_alt = false; /* supersedes the usual prefixing of Esc */
            return int(p - output);

            SmallKeypadKey sk_key;
        case VK_HOME: sk_key = SKK_HOME; goto small_keypad_key;
        case VK_END: sk_key = SKK_END; goto small_keypad_key;
        case VK_INSERT: sk_key = SKK_INSERT; goto small_keypad_key;
        case VK_DELETE: sk_key = SKK_DELETE; goto small_keypad_key;
        case VK_PRIOR: sk_key = SKK_PGUP; goto small_keypad_key;
        case VK_NEXT: sk_key = SKK_PGDN; goto small_keypad_key;
        small_keypad_key:
            /* These keys don't generate terminal input with Ctrl */
            if (shift_state & 2)
                break;

            p += format_small_keypad_key((char *)p, term.get(), sk_key);
            return int(p - output);

            char xkey;
        case VK_UP: xkey = 'A'; goto arrow_key;
        case VK_DOWN: xkey = 'B'; goto arrow_key;
        case VK_RIGHT: xkey = 'C'; goto arrow_key;
        case VK_LEFT: xkey = 'D'; goto arrow_key;
        case VK_CLEAR: xkey = 'G'; goto arrow_key; /* close enough */
        arrow_key:
            consumed_alt = false;
            p += format_arrow_key((char *)p, term.get(), xkey, shift_state & 1, shift_state & 2, left_alt, &consumed_alt);
            if (consumed_alt)
                left_alt = false; /* supersedes the usual prefixing of Esc */
            return int(p - output);

        case VK_RETURN:
            if (HIWORD(lParam) & KF_EXTENDED) {
                keypad_key = '\r';
                goto numeric_keypad;
            }
        ordinary_return_key:
            if (shift_state == 0 && term->cr_lf_return) {
                *p++ = '\r';
                *p++ = '\n';
                return int(p - output);
            } else {
                *p++ = '\r';
                *p++ = 0;
                return -2;
            }
        }
    }

    /* Okay we've done everything interesting; let windows deal with
     * the boring stuff */
    {
        bool capsOn = false;

        /* XXX how do we know what the max size of the keys array should
         * be is? There's indication on MS' website of an Inquire/InquireEx
         * functioning returning a KBINFO structure which tells us. */
        r = ToUnicodeEx(UINT(wParam), scan, keystate, keys_unicode,
                            lenof(keys_unicode), 0, kbd_layout);

        if (r > 0) {
            WCHAR keybuf;

            p = output;
            for (int i = 0; i < r; i++) {
                wchar_t wch = keys_unicode[i];

                if (compose_state == 2 && wch >= ' ' && wch < 0x80) {
                    compose_char = wch;
                    compose_state++;
                    continue;
                }
                if (compose_state == 3 && wch >= ' ' && wch < 0x80) {
                    int nc;
                    compose_state = 0;

                    if ((nc = check_compose(compose_char, wch)) == -1) {
                        MessageBeep(MB_ICONHAND);
                        return 0;
                    }
                    keybuf = nc;
                    term->term_keyinputw(&keybuf, 1);
                    continue;
                }

                compose_state = 0;

                if (!key_down) {
                    if (alt_sum) {
                        keybuf = alt_sum;
                        term->term_keyinputw(&keybuf, 1);
                        alt_sum = 0;
                    } else {
                        term->term_keyinputw(&wch, 1);
                    }
                } else {
                    if(capsOn && wch < 0x80) {
                        WCHAR cbuf[2];
                        cbuf[0] = 27;
                        cbuf[1] = xlat_uskbd2cyrllic(wch);
                        term->term_keyinputw(cbuf+!left_alt, 1+!!left_alt);
                    } else {
                        WCHAR cbuf[2];
                        cbuf[0] = '\033';
                        cbuf[1] = wch;
                        term->term_keyinputw(cbuf +!left_alt, 1+!!left_alt);
                    }
                }
            }

            /* This is so the ALT-Numpad and dead keys work correctly. */
            keys_unicode[0] = 0;

            return int(p - output);
        }
        /* If we're definitely not building up an ALT-54321 then clear it */
        if (!left_alt)
            keys_unicode[0] = 0;
        /* If we will be using alt_sum fix the 256s */
        else if (keys_unicode[0])
            keys_unicode[0] = 10;
    }

    if (wParam == VK_MENU) // alt
        return 0;

    return -1;
}

void TermWinWindows::set_title(string title)
{
    if(window_name == title)
        return;

    window_name = title;
    SetWindowTextW(hwnd, utf8_to_wstring(title).c_str());
}

void TermWinWindows::set_scrollbar(int total, int start, int page)
{
    SCROLLINFO si;

    si.cbSize = sizeof(si);
    si.fMask = SIF_ALL | SIF_DISABLENOSCROLL;
    si.nMin = 0;
    si.nMax = total - 1;
    si.nPage = page;
    si.nPos = start;
    if (hwnd)
        SetScrollInfo(hwnd, SB_VERT, &si, true);
}

bool TermWinWindows::setup_draw_ctx()
{
    assert(!wintw_hdc);
    wintw_hdc = make_hdc();
    return wintw_hdc != NULL;
}

void TermWinWindows::free_draw_ctx()
{
    assert(wintw_hdc);
    free_hdc(wintw_hdc);
    wintw_hdc = NULL;
}

/*
 * Set up the color palette.
 */
void TermWinWindows::init_palette()
{
    pal = NULL;
    for (unsigned i = 0; i < OSC4_NCOLORS; i++)
        palette_entries[i].peFlags = PC_NOCOLLAPSE;
}

void TermWinWindows::palette_set(unsigned start, unsigned ncolors, const rgb *colors_in)
{
    assert(start <= OSC4_NCOLORS);
    assert(ncolors <= OSC4_NCOLORS - start);

    for (unsigned i = 0; i < ncolors; i++) {
        const rgb *in = &colors_in[i];
        PALETTEENTRY *out = &palette_entries[i + start];
        out->peRed = in->r;
        out->peGreen = in->g;
        out->peBlue = in->b;
        colors[i + start] = RGB(in->r, in->g, in->b) ^ colorref_modifier;
    }

    if (pal) {
        /* We already had a palette, so replace the changed colors in the
         * existing one. */
        SetPaletteEntries(pal, start, ncolors, &palette_entries[start]);

        HDC hdc = make_hdc();
        UnrealizeObject(pal);
        RealizePalette(hdc);
        free_hdc(hdc);
    }
}

typedef struct _rgbindex {
    int index;
    COLORREF ref;
} rgbindex;

int cmpCOLORREF(void *va, void *vb)
{
    COLORREF a = ((rgbindex *)va)->ref;
    COLORREF b = ((rgbindex *)vb)->ref;
    return (a < b) ? -1 : (a > b) ? +1 : 0;
}

void TermWinWindows::clip_write(wchar_t *data, int len, bool must_deselect)
{
    HGLOBAL clipdata = GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, len * sizeof(wchar_t));
    if(!clipdata)
        return;

    void *lock = GlobalLock(clipdata);
    if (lock == nullptr) {
        GlobalFree(clipdata);
        return;
    }

    memcpy(lock, data, len * sizeof(wchar_t));
    GlobalUnlock(clipdata);

    if (!must_deselect)
        SendMessage(hwnd, WM_APP_IGNORE_CLIP, true, 0);

    if (OpenClipboard(hwnd)) {
        EmptyClipboard();
        SetClipboardData(CF_UNICODETEXT, clipdata);
        CloseClipboard();
    } else {
        GlobalFree(clipdata);
    }

    if (!must_deselect)
        SendMessage(hwnd, WM_APP_IGNORE_CLIP, false, 0);
}

void TermWinWindows::clip_request_paste()
{
    if (!OpenClipboard(NULL))
        return;

    HGLOBAL clipdata;
    if ((clipdata = GetClipboardData(CF_UNICODETEXT)))
        process_clipdata(clipdata, true);
    else if ((clipdata = GetClipboardData(CF_TEXT)))
        process_clipdata(clipdata, false);

    CloseClipboard();
}

void TermWinWindows::process_clipdata(HGLOBAL clipdata, bool unicode)
{
    wstring clipboard_contents;

    if (unicode) {
        wchar_t *p = (wchar_t *) GlobalLock(clipdata);
        if (p == nullptr)
            return;

        clipboard_contents = p;
        GlobalUnlock(p);
    } else {
        char *s = (char *) GlobalLock(clipdata);
        if (s == nullptr)
            return;

        int i = MultiByteToWideChar(CP_ACP, 0, s, strlen(s) + 1, 0, 0);
        clipboard_contents.resize(i);
        MultiByteToWideChar(CP_ACP, 0, s, strlen(s) + 1, clipboard_contents.data(), i);
        GlobalUnlock(s);
    }

    term->term_do_paste(clipboard_contents);
}

// Move the window in response to a server-side request.
void TermWinWindows::move(int x, int y)
{
    if (IsZoomed(hwnd))
       return;

    SetWindowPos(hwnd, NULL, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
}

// Refresh the window in response to a server-side request.
void TermWinWindows::refresh()
{
    InvalidateRect(hwnd, NULL, true);
}

/* Get the rect/size of a full screen window using the nearest available
 * monitor in multimon systems; default to something sensible if only
 * one monitor is present. */
RECT TermWinWindows::get_fullscreen_rect()
{
    HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);

    MONITORINFO mi;
    mi.cbSize = sizeof(mi);
    GetMonitorInfo(mon, &mi);
    return mi.rcMonitor;
}

void TermWinWindows::unthrottle(size_t bufsize)
{
    if (backend)
        backend->unthrottle(bufsize);
}

// A wrapper around TermWinWindows to run it in a thread, and allow interacting
// with it from other threads.
class ThreadedTerminalWindow: public VVTerm
{
public:
    shared_ptr<TermWinWindows> window;

    HANDLE thread = INVALID_HANDLE_VALUE;
    CRITICAL_SECTION crit_section;
    CONDITION_VARIABLE condition = CONDITION_VARIABLE_INIT;

    ThreadedTerminalWindow()
    {
        // Start our thread.
        thread = CreateThread(NULL, 0, init_stub, this, 0, nullptr);

        // Wait until init() is done initializing.
        InitializeCriticalSection(&crit_section);
        EnterCriticalSection(&crit_section);
        while(window == nullptr)
            SleepConditionVariableCS(&condition, &crit_section, INFINITE);
        LeaveCriticalSection(&crit_section);
    }

    static DWORD init_stub(void *ptr) { ThreadedTerminalWindow *self = (ThreadedTerminalWindow *) ptr; self->init(); return 0; }
    void init()
    {
        // Lock while we create the window, then signal the condition to let the
        // application thread know window->hwnd is ready.
        EnterCriticalSection(&crit_section);
        window = make_shared<TermWinWindows>();
        WakeAllConditionVariable(&condition);
        LeaveCriticalSection(&crit_section);

        // Run the message loop.  This will run until we're shut down.
        window->run();

        // Lock while we clear window->hwnd, then signal to let shutdown() know
        // that hwnd is null.
        EnterCriticalSection(&crit_section);
        window->close_session();
        assert(window->hwnd == nullptr);
        WakeAllConditionVariable(&condition);
        LeaveCriticalSection(&crit_section);
    }

    // VVTerm implementation
    // 
    // These functions can be called from any thread.  They shouldn't be called from
    // multiple threads concurrently.
    //
    // Note that if the thread is shut down, SendMessage will return 0.
    void set_visible(bool visible) override
    {
        SendMessage(window->hwnd, WM_APP_SET_VISIBLE, visible, 0);
    }

    bool get_visible() const override
    {
        bool result = false;
        SendMessage(window->hwnd, WM_APP_GET_VISIBLE, 0, (intptr_t) &result);
        return result;
    }

    void get_handles(HANDLE *events, HANDLE *input, HANDLE *output) override
    {
        *events = *input = *output = INVALID_HANDLE_VALUE;

        GetHandles result;
        result.input = input;
        result.output = output;
        result.events = events;

        SendMessage(window->hwnd, WM_APP_GET_HANDLES, 0, (LPARAM) &result);
    }

    VVTermEvent get_next_event() override
    {
        return window->threaded_get_next_event();
    }

    ~ThreadedTerminalWindow()
    {
        // Run WM_APP_SHUTDOWN.  SendMessage won't return until the message is processed,
        // so the window will be shut down when this returns.
        LRESULT result = SendMessage(window->hwnd, WM_APP_SHUTDOWN, 0, 0);

        // If result returned 0, the window has already exited.  This happens if the
        // application is exiting without having closed the window first, so the window
        // has already exited.  
        // If SendMessage returned 1, WM_APP_SHUTDOWN ran normally, so wait until run()
        // exits and shuts down the window.
        //
        // If SendMessage returned 0, the window has already exited and the window has
        // already been destroyed.  This normally only happens if the application is exiting
        // and we're being shut down during global cleanup.  Don't wait in this case, since
        // there's no window running and we'll get stuck.
        string s = win_strerror(GetLastError());
        if(result != 0)
        {
            EnterCriticalSection(&crit_section);
            while(window->hwnd != nullptr)
                SleepConditionVariableCS(&condition, &crit_section, INFINITE);
            LeaveCriticalSection(&crit_section);
        }

        // Clean up the thread.
        WaitForSingleObject(thread, INFINITE);
        CloseHandle(thread);
        thread = INVALID_HANDLE_VALUE;
        DeleteCriticalSection(&crit_section);

        // Destroy the TermWinWindows.  This will happen when we return anyway,
        // this is just clearer when debugging.
        window.reset();
    }
};

shared_ptr<VVTerm> VVTerm::create()
{
    return make_shared<ThreadedTerminalWindow>();
}
