/*
 * timing.c
 *
 * This module tracks any timers set up by schedule_timer(). It
 * keeps all the currently active timers in a list; it informs the
 * front end of when the next timer is due to go off if that
 * changes; and, very importantly, it tracks the context pointers
 * passed to schedule_timer(), so that if a context is freed all
 * the timers associated with it can be immediately annulled.
 *
 *
 * The problem is that computer clocks aren't perfectly accurate.
 * The GetTickCount function returns a 32bit number that normally
 * increases by about 1000 every second. On windows this uses the PC's
 * interrupt timer and so is only accurate to around 20ppm.  On unix it's
 * a value that's calculated from the current UTC time and so is in theory
 * accurate in the long term but may jitter and jump in the short term.
 *
 * What PuTTY needs from these timers is simply a way of delaying the
 * calling of a function for a little while, if it's occasionally called a
 * little early or late that's not a problem. So to protect against clock
 * jumps schedule_timer records the time that it was called in the timer
 * structure. With this information the run_timers function can see when
 * the current GetTickCount value is after the time the event should be
 * fired OR before the time it was set. In the latter case the clock must
 * have jumped, the former is (probably) just the normal passage of time.
 */

#include <windows.h>

#include <assert.h>
#include <stdio.h>
#include <set>
using namespace std;

#include "timing.h"

struct timer
{
    bool operator<(const timer &rhs) const
    {
        if(fn != rhs.fn)
            return fn < rhs.fn;
        if(ctx != rhs.ctx)
            return ctx < rhs.ctx;
        return 0;
    }

    timer_fn_t fn;
    void *ctx = nullptr;
    unsigned long now = 0;
    unsigned long when_set = 0;
};

static set<timer> all_timers;
static unsigned long now = 0L;
static bool initialized = false;
static HWND timer_hwnd;
static int timer_message_id;

static void init_timers()
{
    if(initialized)
        return;

    initialized = true;
    now = GetTickCount();
}

unsigned long schedule_timer(int ticks, timer_fn_t fn, void *ctx)
{
    unsigned long when;

    init_timers();

    now = GetTickCount();
    when = ticks + now;

    /*
     * Just in case our various defences against timing skew fail
     * us: if we try to schedule a timer that's already in the
     * past, we instead schedule it for the immediate future.
     */
    if (when - now <= 0)
        when = now + 1;

    timer t;
    t.fn = fn;
    t.ctx = ctx;
    t.now = when;
    t.when_set = now;

    if(all_timers.find(t) == all_timers.end())
        all_timers.insert(t);

    const timer &first = *all_timers.begin();
    if(first.fn == t.fn && first.ctx == t.ctx)
    {
        /*
         * This timer is the very first on the list, so we must
         * notify the front end.
         */
        SendMessage(timer_hwnd, timer_message_id, first.now, 0);
    }

    return when;
}

unsigned long timing_last_clock()
{
    /*
     * Return the last value we stored in 'now'. In particular,
     * calling this just after schedule_timer returns the value of
     * 'now' that was used to decide when the timer you just set would
     * go off.
     */
    return now;
}

void timing_set_hwnd(HWND hwnd, int message_id)
{
    timer_hwnd = hwnd;
    timer_message_id = message_id;
}

/*
 * Call to run any timers whose time has reached the present.
 * Returns the time (in ticks) expected until the next timer after
 * that triggers.
 */
bool run_timers(unsigned long anow, unsigned long *next)
{
    init_timers();

    now = GetTickCount();

    if(all_timers.empty())
        return false;

    while(!all_timers.empty())
    {
        timer first = *all_timers.begin();

        if (now - (first.when_set - 10) > first.now - (first.when_set - 10))
        {
            // This timer is active and has reached its running time. Run it.
            all_timers.erase(all_timers.begin());
            first.fn(first.ctx, first.now);
        } else {
            // This is the first still-active timer that is in the
            // future. Return how long it has yet to go.
            *next = first.now;
            return true;
        }
    }

    return true;
}

// Expire all timers associated with the given context.
void expire_timer_context(void *ctx)
{
    init_timers();

    // Remove all timers on this context.
    auto it = all_timers.begin();
    while(it != all_timers.end())
    {
        auto next = it;
        next++;

        if(it->ctx == ctx)
            all_timers.erase(it);
        it = next;
    }
}
