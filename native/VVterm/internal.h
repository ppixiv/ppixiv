#ifndef internal_h
#define internal_h

#include <stddef.h>
#include <limits.h>
#include <stdio.h>
#include <windows.h>

#include <string>
#include <memory>
using namespace std;

#include "misc.h"

// After windows.h because Windows headers are braindamaged:
#include <map>
#include <memory>
#include <string>
#include <vector>
using namespace std;

#define TICKSPERSEC 1000               // GetTickCount returns milliseconds

typedef enum {
    MBT_NOTHING,
    MBT_LEFT, MBT_MIDDLE, MBT_RIGHT,   /* `raw' button designations */
    MBT_SELECT, MBT_EXTEND, MBT_PASTE, /* `cooked' button designations */
    MBT_WHEEL_UP, MBT_WHEEL_DOWN       /* mouse wheel */
} Mouse_Button;

typedef enum {
    MA_NOTHING, MA_CLICK, MA_2CLK, MA_3CLK, MA_DRAG, MA_RELEASE
} Mouse_Action;

/*
 * Name of this particular application, for use in the config box
 * and other pieces of text.
 */
extern const wchar_t *const appname;

/*
 * Data type definitions for true-color terminal display.
 * 'optionalrgb' describes a single RGB color, which overrides the
 * other color settings if 'enabled' is nonzero, and is ignored
 * otherwise. 'truecolor' contains a pair of those for foreground and
 * background.
 */
typedef struct optionalrgb {
    bool enabled;
    unsigned char r, g, b;
} optionalrgb;
extern const optionalrgb optionalrgb_none;
typedef struct truecolor {
    optionalrgb fg, bg;
} truecolor;
#define optionalrgb_equal(r1,r2) (                              \
        (r1).enabled==(r2).enabled &&                           \
        (r1).r==(r2).r && (r1).g==(r2).g && (r1).b==(r2).b)
#define truecolor_equal(c1,c2) (               \
        optionalrgb_equal((c1).fg, (c2).fg) &&  \
        optionalrgb_equal((c1).bg, (c2).bg))

struct rgb {
    uint8_t r, g, b;
};

struct FontSpec {
    FontSpec(string name_, bool isbold_=false, int height_=10):
        name(name_), isbold(isbold_), height(height_) { }
    string name;
    bool isbold = false;
    int height = 10;
};

struct TermConfig
{
    // This is just set to the random font I've used for years, since there's no font
    // configuration yet. XXX
    TermConfig(): font("MS Gothic", false, 12) { }

    string wintitle = "VView";

    // Terminal options
    int scrollback_lines = 2000;
    int width = 80, height = 24;
    FontSpec font;
};

typedef enum SmallKeypadKey {
    SKK_HOME, SKK_END, SKK_INSERT, SKK_DELETE, SKK_PGUP, SKK_PGDN,
} SmallKeypadKey;

class Terminal;
int format_arrow_key(char *buf, Terminal *term, int xkey, bool shift, bool ctrl, bool alt, bool *consumed_alt);
int format_function_key(char *buf, Terminal *term, int key_number, bool shift, bool ctrl, bool alt, bool *consumed_alt);
int format_small_keypad_key(char *buf, Terminal *term, SmallKeypadKey key);
int format_numeric_keypad_key(char *buf, Terminal *term, char key, bool shift, bool ctrl);

#define IS_SURROGATE(wch) (((wch) >= HIGH_SURROGATE_START) && ((wch) <= LOW_SURROGATE_END))
#define HIGH_SURROGATE_OF(codept)   (HIGH_SURROGATE_START + (((codept) - 0x10000) >> 10))
#define LOW_SURROGATE_OF(codept)    (LOW_SURROGATE_START + (((codept) - 0x10000) & 0x3FF))
#define FROM_SURROGATES(wch1, wch2) (0x10000 + (((wch1) & 0x3FF) << 10) + ((wch2) & 0x3FF))

#endif
