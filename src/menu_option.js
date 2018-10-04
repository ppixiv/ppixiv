// Simple menu settings widgets.
class menu_option
{
    constructor(container, options)
    {
        this.refresh = this.refresh.bind(this);

        this.container = container;
        this.options = options;

        settings.register_change_callback(this.options.setting, this.refresh);
    }

    get value()
    {
        return settings.get(this.options.setting);
    }

    set value(value)
    {
        settings.set(this.options.setting, value);
    }

    refresh()
    {
        if(this.options.onchange)
            this.options.onchange();
    }            
}

class menu_option_toggle extends menu_option
{
    constructor(container, options)
    {
        super(container, options);

        this.onclick = this.onclick.bind(this);

        this.item = helpers.create_from_template(".template-menu-toggle");
        this.container.appendChild(this.item);
        this.item.addEventListener("click", this.onclick);
        this.item.querySelector(".label").innerText = options.label;

        this.refresh();
    }

    refresh()
    {
        super.refresh();

        var value = this.value;
        if(this.options.invert_display)
            value = !value;
        
        this.item.querySelector(".on").hidden = !value;
        this.item.querySelector(".off").hidden = value;
    }

    onclick(e)
    {
        e.preventDefault();
        e.stopPropagation();

        this.value = !this.value;
    }
}

// A special case for the theme, which is just a light/dark toggle but stored
// as a string.
class menu_option_toggle_light_theme extends menu_option_toggle
{
    get value()
    {
        var value = super.value;
        return value == "light";
    }

    set value(value)
    {
        super.value = value? "light":"dark";
    }
}

class menu_option_slider extends menu_option
{
    constructor(container, options)
    {
        super(container, options);

        this.oninput = this.oninput.bind(this);

        this.item = helpers.create_from_template(".template-menu-slider");
        this.item.addEventListener("input", this.oninput);
        this.item.querySelector(".label").innerText = options.label;

        this.slider = this.item.querySelector("input");
        this.slider.min = this.options.min;
        this.slider.max = this.options.max;
        this.container.appendChild(this.item);
    }
    
    refresh()
    {
        this._slider_value = this.value;
        super.refresh();
    }

    oninput(e)
    {
        this.value = this._slider_value;
    }

    get value()
    {
        return parseInt(super.value);
    }
    
    set value(value)
    {
        super.value = value;
    }

    set _slider_value(value)
    {
        if(this.slider.value == value)
            return;

        this.slider.value = value;
    }

    get _slider_value()
    {
        return parseInt(this.slider.value);
    }
}


// A widget to control the thumbnail size slider.
class thumbnail_size_slider_widget extends menu_option_slider
{
    constructor(container, options)
    {
        super(container, options);

        this.onwheel = this.onwheel.bind(this);
        this.onkeydown = this.onkeydown.bind(this);

        var view = this.container.closest(".view");
        view.addEventListener("wheel", this.onwheel);
        view.addEventListener("keydown", this.onkeydown);

        this.refresh();
    }

    get min_value() { return this.options.min; }
    get max_value() { return this.options.max; }

    onkeydown(e)
    {
        var zoom = helpers.is_zoom_hotkey(e);
        if(zoom != null)
        {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.move(zoom < 0);
        }
    }

    onwheel(e)
    {
        if(!e.ctrlKey)
            return;

        e.preventDefault();
        e.stopImmediatePropagation();

        this.move(e.deltaY > 0);
    }

    // Increase or decrease zoom.
    move(down)
    {
        var value = this._slider_value;
        value += down?-1:+1;
        value = helpers.clamp(value, 0, 5);
        this._slider_value = value;
        this.value = this._slider_value;
    }

    get value()
    {
        var value = super.value;
        if(typeof(value) != "number" || isNaN(value))
            value = 4;
        return value;
    }
    
    set value(value)
    {
        super.value = value;
    }

    get thumbnail_size()
    {
        var width = 100 * Math.pow(1.3, this.slider.value);
        return width;
    }
};


