"use strict";

// A simple progress bar.
//
// Call bar.controller() to create a controller to update the progress bar.
ppixiv.progress_bar = class extends ppixiv.widget
{
    constructor({...options})
    {
        super({ ...options, template: `
            <div class=loading-progress-bar>
                <div class=progress-bar hidden></div>
            </div>            
        `});

        this.bar = this.container.querySelector(".progress-bar");
    };

    // Create a progress_bar_controller for this progress bar.
    //
    // If there was a previous controller, it will be detached.
    controller()
    {
        if(this.current_controller)
        {
            this.current_controller.detach();
            this.current_controller = null;
        }

        this.current_controller = new progress_bar_controller(this);
        return this.current_controller;
    }
}

// This handles updating a progress_bar.
//
// This is separated from progress_bar, which allows us to transparently detach
// the controller from a progress_bar.
//
// For example, if we load a video file and show the loading in the progress bar, and
// the user then navigates to another video, we detach the first controller.  This way,
// the new load will take over the progress bar (whether or not we actually cancel the
// earlier load) and progress bar users won't fight with each other.
ppixiv.progress_bar_controller = class
{
    constructor(bar)
    {
        this.progress_bar = bar;
    }

    set(value)
    {
        if(this.progress_bar == null)
            return;

        this.progress_bar.bar.hidden = (value == null);
        this.progress_bar.bar.classList.remove("hide");
        this.progress_bar.bar.getBoundingClientRect();
        if(value != null)
            this.progress_bar.bar.style.width = (value * 100) + "%";
    }

    // Flash the current progress value and fade out.
    show_briefly()
    {
        this.progress_bar.bar.classList.add("hide");
    }

    detach()
    {
        this.progress_bar = null;
    }
};
