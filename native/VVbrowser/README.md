VVbrowser opens a custom WebView2-based browser window.

This provides a lightweight Python interface for opening a browser window using WebView2.
This lets us work around a bunch of annoying issues with running applications solely inside
regular browsers:

- Browsers show an annoying "Waiting for 127.0.0.1..." status bar that flashes over the image randomly,
  and you can't even disable it when in app mode.
- They won't open windows with a specific size, to allow giving a sensible window size when opening
  an image from File Explorer, or to remember window positions.
- They add the user's profile image to the corner of every browser icon.  This is a pointless
gimmick that just makes all browser icons ugly, and it's extra annoying when it's on top of your
application's icon.
- They show "Press Esc to exit full screen" repeatedly when in fullscreen.  Chrome assumes users are
too stupid to be allowed to disable this, and it's distracting and ugly.  The only workaround seems
to be kiosk mode, but that only works if it's on a separate profile entirely, and you can't switch
between an application window and fullscreen with it.

Our process is a lightweight front-end to the browser.  WebView2 does the actual work in ints own
processes.  This means our processes are lightweight, and it's easy and cheap to run windows in
multiple processes.

This uses WebView2 rather than CEF.  CEF needs to be bundled with the application and is nearly
100 MB, but installing and updating WebView2 is managed by the OS.


