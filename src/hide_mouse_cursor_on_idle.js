// Hide the mouse cursor when it hasn't moved briefly, to get it out of the way.
// This only hides the cursor over element.
//
// Chrome's cursor handling is buggy and doesn't update the cursor when it's not
// moving, so this only works in Firefox.
var hide_mouse_cursor_on_idle = function(element)
{
    this.onmousemove = this.onmousemove.bind(this);
    this.onblur = this.onblur.bind(this);
    this.idle = this.idle.bind(this);
    this.hide_immediately = this.hide_immediately.bind(this);

    this.element = element;

    this.force_hidden_until = null;

    window.addEventListener("mousemove", this.onmousemove, true);
    window.addEventListener("blur", this.blur, true);
    window.addEventListener("hide-cursor-immediately", this.hide_immediately, true);

    this.reset_timer();
};

hide_mouse_cursor_on_idle.prototype.remove_timer = function()
{
    if(!this.timer)
        return;

    clearInterval(this.timer);
    this.timer = null;
}

// Hide the cursor now, and keep it hidden very briefly even if it moves.  This is done
// when releasing a zoom to prevent spuriously showing the mouse cursor.
hide_mouse_cursor_on_idle.prototype.hide_immediately = function(e)
{
    this.force_hidden_until = Date.now() + 150;
    this.idle();
}

hide_mouse_cursor_on_idle.prototype.reset_timer = function()
{
    this.show_cursor();

    this.remove_timer();
    this.timer = setTimeout(this.idle, 500);
}

hide_mouse_cursor_on_idle.prototype.idle = function()
{
    this.remove_timer();
    this.hide_cursor();
}

hide_mouse_cursor_on_idle.prototype.onmousemove = function(e)
{
    if(this.force_hidden_until && this.force_hidden_until > Date.now())
        return;

    this.reset_timer();
}

hide_mouse_cursor_on_idle.prototype.onblur = function(e)
{
    this.remove_timer();
    this.show_cursor();
}

hide_mouse_cursor_on_idle.prototype.show_cursor = function(e)
{
//    this.element.style.cursor = "";
    this.element.classList.remove("hide-cursor");
}

hide_mouse_cursor_on_idle.prototype.hide_cursor = function(e)
{
    // Setting style.cursor to none doesn't work in Chrome.  Doing it with a style works
    // intermittently (seems to work better in fullscreen).  Firefox doesn't have these
    // problems.
//    this.element.style.cursor = "none";
    this.element.classList.add("hide-cursor");
}
