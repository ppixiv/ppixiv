#include "VVbrowserWindow.h"
#include "WebViewHelpers.h"
#include "resource.h"

#include <functional>
#include <regex>
#include <string>
#include <vector>
#include <sstream>
#include <shellapi.h>
#include <shellscalingapi.h>
#include <shobjidl.h>
#include <gdiplus.h>
#include <dwmapi.h>
#include <shlwapi.h>
#include <wininet.h>
using namespace std;

#pragma comment(lib, "urlmon.lib") // URLDownloadToFile
#pragma comment(lib, "pathcch.lib") // PathCchRemoveFileSpec
#pragma comment(lib, "dwmapi.lib") // DwmSetWindowAttribute
#pragma comment(lib, "shlwapi.lib") // UrlUnescape

// #pragma comment(lib, "gdiplus.lib")

using namespace Microsoft::WRL;

enum {
    WM_APP_RUN_ASYNC_MESSAGE = WM_APP,
};

static thread_local size_t instanceCount = 0;

namespace
{
    // Get the width and height added to the client size to get the window size.
    void GetWindowBorderSize(int windowStyle, int exWindowStyle, int *extraWindowWidth, int *extraWindowHeight)
    {
        // XXX: AdjustWindowRectExForDpi?

        RECT rect1 = { 100, 100, 200, 200 };
        RECT rect2 = rect1;
        AdjustWindowRectEx(&rect2, windowStyle, false /* no menu */, exWindowStyle);
        *extraWindowWidth = (rect2.right - rect2.left) - (rect1.right - rect1.left);
        *extraWindowHeight = (rect2.bottom - rect2.top) - (rect1.bottom - rect1.top);
    }

    void ClearWindow(HWND hwnd)
    {
        // Clear the window, so we don't flash the default white background before the first paint.
        PAINTSTRUCT ps;
        BeginPaint(hwnd, &ps);

        RECT rect;
        GetClientRect(hwnd, &rect); 

        HDC hdc = GetDC(hwnd);
        FillRect(hdc, &rect, (HBRUSH) GetStockObject(BLACK_BRUSH));
        ReleaseDC(hwnd, hdc);

        EndPaint(hwnd, &ps);
    }
}

VVbrowserWindow::VVbrowserWindow(Config config_)
{
    config = config_;

    CHECK_FAILURE(OleInitialize(NULL));

    SetCurrentProcessExplicitAppUserModelID(L"VView.Browser");
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    ++instanceCount;

    // Get an HINSTANCE for the containing application to use for creating windows.
    // Note that this isn't the DLL we're contained in, so we can't use this to access
    // resources inside it.
    wchar_t appPath[MAX_PATH];
    GetModuleFileName(NULL, appPath, MAX_PATH);
    HINSTANCE hinst = LoadLibrary(appPath);

    // Setting WS_EX_NOREDIRECTIONBITMAP allows direct compositing, so page transparency
    // shows through to the window behind it.  This is only visible if the page makes its
    // background transparent.
    int windowStyle = WS_OVERLAPPEDWINDOW;
    int exWindowStyle = WS_EX_CONTROLPARENT|WS_EX_NOREDIRECTIONBITMAP;

    int x = CW_USEDEFAULT;
    int y = CW_USEDEFAULT;
    int width = CW_USEDEFAULT, height = CW_USEDEFAULT;

    // If fitWidth and fitHeight are set, figure out a window size to view an image of that
    // size, and center it on the monitor.  Otherwise, we'll just use default window positioning.
    if(config.fitWidth != -1 && config.fitHeight != -1)
    {
        width = config.fitWidth;
        height = config.fitHeight;

        // Decide which monitor we want to put the window on.  Use the monitor the cursor is
        // on, to mimic Windows's default behavior.
        POINT cursorPos;
        GetCursorPos(&cursorPos);
        HMONITOR monitor = MonitorFromPoint(cursorPos, MONITOR_DEFAULTTOPRIMARY);

        MONITORINFO monitorInfo = {sizeof(monitorInfo)};
        if(!GetMonitorInfo(monitor, &monitorInfo))
        {
            MessageBox(nullptr, L"GetMonitorInfo failed", nullptr, MB_OK);
            return;
        }

        // The size we're fitting into:
        int monitorWidth = monitorInfo.rcWork.right - monitorInfo.rcWork.left;
        int monitorHeight = monitorInfo.rcWork.bottom - monitorInfo.rcWork.top;

        // The amount of extra space used by the window frame and titlebar:
        int extraWindowWidth, extraWindowHeight;
        GetWindowBorderSize(windowStyle, exWindowStyle, &extraWindowWidth, &extraWindowHeight);

        // If we're fitting the window to the screen, availableWidth/availableHeight is the maximum
        // size we have available for the client area: the monitor size minus the window border.
        int availableWidth = monitorWidth - extraWindowWidth;
        int availableHeight = monitorHeight - extraWindowHeight;

        // Windows adds an annoying shadow around the window, and this is part of the window size.
        // This causes lots of complications if we want to size the window to match the display on
        // one axis.  We can only access the shadow size after the window is created, and if we match
        // the display size horizontally, the shadow leaks onto the neighboring monitor (this happens
        // even with docking), and it generally makes this a pain.  Instead, don't try to match the
        // display exactly and always leave a bit of space on the edge, so the window is floating
        // slightly.  If the user wants to fill the screen, maximize or fullscreen instead.
        availableWidth -= 50;
        availableHeight -= 50;

        // Fit width/height to fit in availableWidth/availableHeight:
        float ratioFitVertical = float(availableHeight) / height;
        float ratioFitHorizontal = float(availableWidth) / width;
        float ratio = min(ratioFitVertical, ratioFitHorizontal);
        int clientHeight = lrintf(height * ratio);
        int clientWidth = lrintf(width * ratio);

        // Adjust clientWidth and clientHeight to get the window size.
        RECT fixedWindowRect = { 0, 0, clientWidth, clientHeight };
        AdjustWindowRectEx(&fixedWindowRect, windowStyle, false /* no menu */, exWindowStyle);
        width = fixedWindowRect.right - fixedWindowRect.left;
        height = fixedWindowRect.bottom - fixedWindowRect.top;
        
        // Center the result on the monitor.
        x = monitorWidth / 2;
        x -= width / 2;
        y = monitorHeight / 2;
        y -= height / 2;

        // Move onto the monitor we selected.
        x += monitorInfo.rcWork.left;
        y += monitorInfo.rcWork.top;
    }

    const wchar_t *windowClass = GetWindowClass(hinst);

    // Create the window.
    hwnd = CreateWindowExW(
        exWindowStyle, windowClass, config.windowTitle.c_str(), windowStyle,
        x, y, width, height,
        nullptr, nullptr, hinst, nullptr);

    SetWindowLongPtr(hwnd, GWLP_USERDATA, (LONG_PTR) this);

    // Set the default window icon.
    SendMessage(hwnd, WM_SETICON, ICON_BIG, (LPARAM) config.defaultIcon);
    // SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOOWNERZORDER);

    // Enable dark theming for the window.
    //
    // This overrides the user preference.  In this case that's what I prefer: I have
    // most windows set to light mode since application dark mode in Windows is awful,
    // but it makes sense for our image viewing UI, since the window itself is dark by
    // default and it's ugly to have a bright taskbar on top of it.
    int on = true;
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &on, sizeof(on));

    // If we're starting in fullscreen, set it up before showing the window, so we
    // don't flash the non-fullscreen window briefly.
    if(config.fullscreen)
        EnterFullScreen();

    if(config.maximized)
        ShowWindow(hwnd, SW_MAXIMIZE);
    else
        ShowWindow(hwnd, SW_SHOWDEFAULT);

    SetFocus(hwnd);
    UpdateWindow(hwnd);

    // Check if the runtime is installed.  This is be checked by the Python binding first,
    // so this shouldn't fail.
    if(WebViewInstallationRequired())
    {
        MessageBox(hwnd, L"The WebView2 runtime isn't installed.", nullptr, MB_OK);
        return;
    }

    RunAsync([this] {
        InitializeWebView();
    });
}

// Return true if the WebView2 runtime needs to be installed or updated.
bool VVbrowserWindow::WebViewInstallationRequired()
{
    // Check if the runtime is installed.
    wil::unique_cotaskmem_string versionInfo;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &versionInfo);
    
    if(hr != S_OK || versionInfo == nullptr)
        return true;

    // Return true if the installed version is < wantedVersion.
    // 
    // Note that WebView2 versioning is a mess, and the runtime version we get here
    // isn't the same as the SDK version.  See
    //
    // https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes?tabs=dotnetcsharp
    //
    // to map from SDK versions to runtime versions.
    int result = 0;
    const wchar_t *wantedRuntimeVersion = L"101.0.1210.39"; // SDK 1.0.1210.39
    hr = CompareBrowserVersions(versionInfo.get(), wantedRuntimeVersion, &result);
    if(hr != S_OK)
        return false;

    return result < 0;
}

// Register the Win32 window class for the app window.
PCWSTR VVbrowserWindow::GetWindowClass(HINSTANCE hinst)
{
    // Only do this once.
    static PCWSTR windowClass = [hinst] {
        const wchar_t *windowClass = L"VViewBrowserWindow";

        WNDCLASSEXW wcex = {0};
        wcex.cbSize = sizeof(WNDCLASSEX);
        wcex.style = CS_HREDRAW | CS_VREDRAW;
        wcex.lpfnWndProc = WndProcStatic;
        wcex.hInstance = hinst;
        wcex.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wcex.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
        wcex.lpszClassName = windowClass;

        RegisterClassExW(&wcex);
        return windowClass;
    }();

    return windowClass;
}

LRESULT CALLBACK VVbrowserWindow::WndProcStatic(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    auto app = (VVbrowserWindow*) GetWindowLongPtr(hWnd, GWLP_USERDATA);
    if(app)
        return app->HandleWindowMessage(hWnd, message, wParam, lParam);
    else
        return DefWindowProc(hWnd, message, wParam, lParam);
}

LRESULT VVbrowserWindow::HandleWindowMessage(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch(message)
    {
    case WM_SIZE:
        if(controller)
        {
            // Hide and suspend when the window is minimized.
            if(wParam == SIZE_MINIMIZED)
            {
                controller->put_IsVisible(false);
                Suspend();
            }
            else
            {
                controller->put_IsVisible(true);
            }
        }

        // Don't update the size when we're minimized.
        if(lParam)
        {
            SetWebViewSize();
            return true;
        }

        break;

    case WM_MOVE:
    case WM_MOVING:
        if(controller)
            controller->NotifyParentWindowPositionChanged();
        return true;

    case WM_ACTIVATE:
        // When we gain focus, we have to manually tell the controller to focus the view,
        // or it won't receive some keyboard inputs until the window is clicked on.
        if(wParam == 0)
            break;

        RunAsync([this]() {
            if(controller)
                controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        });
        break;

    case WM_DPICHANGED:
    {
        RECT *newWindowSize = (RECT *) lParam;
        SetWindowPos(hWnd,
            nullptr,
            newWindowSize->left,
            newWindowSize->top,
            newWindowSize->right - newWindowSize->left,
            newWindowSize->bottom - newWindowSize->top,
            SWP_NOZORDER | SWP_NOACTIVATE);
        return true;
    }

    case WM_SHOWWINDOW:
        // Hack from:
        //
        // https://stackoverflow.com/a/69789296/136829
        //
        // to try to keep Windows from flashing an ugly white frame when the window
        // is displayed.
        if(!GetLayeredWindowAttributes(hWnd, NULL, NULL, NULL))
        {
            SetLayeredWindowAttributes(hWnd, 0, 0, LWA_ALPHA);
            DefWindowProc(hWnd, WM_ERASEBKGND, (WPARAM)GetDC(hWnd), lParam);
            SetLayeredWindowAttributes(hWnd, 0, 255, LWA_ALPHA);
            AnimateWindow(hWnd, 1, AW_ACTIVATE|AW_BLEND);
        }
        break;

    case WM_ERASEBKGND:
        ClearWindow(hWnd);
        return true;
    case WM_APP_RUN_ASYNC_MESSAGE:
    {
        auto *task = reinterpret_cast<std::function<void()>*>(wParam);
        (*task)();
        delete task;
        return true;
    }
    case WM_CLOSE:
        CloseAppWindow();
        return true;

    case WM_NCDESTROY:
    {
        int retValue = 0;
        SetWindowLongPtr(hWnd, GWLP_USERDATA, NULL);

        // If this is the last window in this thread, tell the window loop to exit.
        if(--instanceCount == 0)
            PostQuitMessage(retValue);

        // Free ourself.
        delete this;

        break;
    }

    case WM_QUERYENDSESSION:
    {
        // WebView2 doesn't give access to session saving and restoration, so it's very
        // difficult to restore state across updates.
        // RegisterApplicationRestart(L"--restore", RESTART_NO_CRASH | RESTART_NO_HANG);
        return true;
    }

    case WM_ENDSESSION:
        if (wParam)
        {
            PostQuitMessage(0);
            return true;
        }
        break;

#if 0
    case WM_KEYDOWN:
    {
        // XXX
        // If bit 30 is set, it means the WM_KEYDOWN message is autorepeated.
        // We want to ignore it in that case.
        if (!(lParam & (1 << 30)))
        {
            if (auto action = GetHotkey((UINT)wParam))
            {
                action();
                return true;
            }
        }
    }
#endif
    }

    return DefWindowProc(hWnd, message, wParam, lParam);
}

void VVbrowserWindow::Suspend()
{
    if(!webview)
        return;

    // Try to suspend the webview.
    webview->TrySuspend(Callback<ICoreWebView2TrySuspendCompletedHandler>(
        [this](HRESULT errorCode, BOOL isSuccessful) -> HRESULT
    {
        return S_OK;
    }).Get());
}

// Return the action for a hotkey, if any.
std::function<void()> VVbrowserWindow::GetHotkey(UINT key)
{
    bool alt = GetKeyState(VK_MENU) < 0;
    bool shift = GetKeyState(VK_SHIFT) < 0;
    bool ctrl = GetKeyState(VK_CONTROL) < 0;

    if(key == VK_F12)
        return [this] { webview->OpenDevToolsWindow(); };

    if(shift && key == VK_ESCAPE)
    {
        return [this] {
            webview->OpenTaskManagerWindow();
        };
    }

    if(ctrl)
    {
        switch (key)
        {
        case 'N': return [this]
        {
            // Create a new window, and load the same URL we're currently on.
            // XXX: how do we just duplicate state, so it retains history, history.data, etc
            wchar_t *currentUrl = nullptr;
            CHECK_FAILURE(webview->get_Source(&currentUrl));
            config.url = currentUrl;

            new VVbrowserWindow(config);
        };
        case 'R': return [this] { webview->Reload(); };
        }
    }
    return nullptr;
}

// Create or recreate the WebView.
void VVbrowserWindow::InitializeWebView()
{
    CloseWebView();

    auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();

    // Disable requiring user interaction for autoplay.  This should go through
    // add_PermissionRequested, but it doesn't.  Also disable spellcheck, which quietly
    // sends user input to Microsoft without permission.
    options->put_AdditionalBrowserArguments(L"--autoplay-policy=no-user-gesture-required --disable-features=msUseSpellCheckCorrectionsCard");

    // If we've been given a profilePath, set it.
    const wchar_t *profilePathPtr = config.profilePath.empty()? nullptr:config.profilePath.c_str();
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, profilePathPtr, options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(this, &VVbrowserWindow::OnCreateEnvironmentCompleted).Get());

    if(!SUCCEEDED(hr))
    {
        switch(hr)
        {
        case HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND):
            MessageBox(hwnd, L"Couldn't find WebView2 runtime.", nullptr, MB_OK);
            break;
        default:
            ShowFailure(hr, L"Error creating view");
            break;
        }
    }
}

HRESULT VVbrowserWindow::OnCreateEnvironmentCompleted(HRESULT result, ICoreWebView2Environment *environment)
{
    CHECK_FAILURE(result);
    webviewEnvironment = environment;

    CHECK_FAILURE(webviewEnvironment->CreateCoreWebView2Controller(
        hwnd,
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            this, &VVbrowserWindow::OnCreateCoreWebView2ControllerCompleted)
        .Get()));

    return S_OK;
}

HRESULT VVbrowserWindow::OnCreateCoreWebView2ControllerCompleted(HRESULT result, ICoreWebView2Controller* controllerBase)
{
    if(result == E_ABORT)
        return result;

    if(result != S_OK)
    {
        ShowFailure(result, L"Error creating WebView2 controller");
        return result;
    }

    // Get our minimum ICoreWebView2Controller version.
    wil::com_ptr<ICoreWebView2Controller> controllerPtr(controllerBase);
    controllerPtr.query_to<ICoreWebView2Controller2>(&controller);

    // Get our minimum ICoreWebView2 version.
    wil::com_ptr<ICoreWebView2> coreWebView2;
    CHECK_FAILURE(controller->get_CoreWebView2(&coreWebView2));
    coreWebView2.query_to(&webview);

    // Set a dark theme to match the rest of the window.  (This doesn't seem to actually
    // do anything.)
    wil::com_ptr<ICoreWebView2Profile> profile;
    CHECK_FAILURE(webview->get_Profile(&profile));
    profile->put_PreferredColorScheme(COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);

    // Create VVbrowserInterface to give to the page.
    m_vvBrowserInterface = Microsoft::WRL::Make<VVbrowserInterface>(this);

    CHECK_FAILURE(webview->add_NavigationStarting(Microsoft::WRL::Callback<ICoreWebView2NavigationStartingEventHandler>(
        [this](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT
    {
        VARIANT remoteObjectAsVariant = {};
        m_vvBrowserInterface.query_to<IDispatch>(&remoteObjectAsVariant.pdispVal);
        remoteObjectAsVariant.vt = VT_DISPATCH;

        CHECK_FAILURE(webview->AddHostObjectToScript(L"vvbrowser", &remoteObjectAsVariant));
        remoteObjectAsVariant.pdispVal->Release();

        return S_OK;
    }).Get(), nullptr));

    // Load settings.
    {
        wil::com_ptr<ICoreWebView2Settings> settingsBase;
        CHECK_FAILURE(webview->get_Settings(&settingsBase));
        auto settings = settingsBase.try_query<ICoreWebView2Settings6>();

        CHECK_FAILURE(settings->put_IsWebMessageEnabled(true));
        CHECK_FAILURE(settings->put_AreHostObjectsAllowed(true));
        CHECK_FAILURE(settings->put_IsZoomControlEnabled(false));
        CHECK_FAILURE(settings->put_IsPinchZoomEnabled(false));
        CHECK_FAILURE(settings->put_IsBuiltInErrorPageEnabled(true));
        CHECK_FAILURE(settings->put_IsPasswordAutosaveEnabled(false));
        CHECK_FAILURE(settings->put_IsStatusBarEnabled(false));
        CHECK_FAILURE(settings->put_IsGeneralAutofillEnabled(false));
        CHECK_FAILURE(settings->put_AreBrowserAcceleratorKeysEnabled(false));
        CHECK_FAILURE(settings->put_IsSwipeNavigationEnabled(false));
        CHECK_FAILURE(settings->put_AreDefaultContextMenusEnabled(false));
        CHECK_FAILURE(settings->put_AreDefaultScriptDialogsEnabled(true));
        CHECK_FAILURE(settings->put_AreDevToolsEnabled(true));

        // Set our user-agent, so our scripts can detect that they're running
        // in this environment.
        wchar_t *userAgent;
        CHECK_FAILURE(settings->get_UserAgent(&userAgent));
        wstring ourUserAgent = wstring(userAgent) + L" VVbrowser/1.0";
        settings->put_UserAgent(ourUserAgent.c_str());

        COREWEBVIEW2_COLOR m_webViewColor = { 0, 0, 0, 255 };
        controller->put_DefaultBackgroundColor(m_webViewColor);
    }

    AddCallbacks();
    SetWebViewSize();

    // Make sure the view has focus inside the window.  This is done in WM_ACTIVATE,
    // but the controller isn't set when we get that during setup.
    controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);

    // If we're loading due to a window.open call, complete the request.
    if(config.onInitializationComplete)
    {
        config.onInitializationComplete(this);
        config.onInitializationComplete = nullptr;
    }

    // If we have a default URL, navigate to it.
    if(!config.url.empty())
        CHECK_FAILURE(webview->Navigate(config.url.c_str()));

    return S_OK;
}

void VVbrowserWindow::AddCallbacks()
{
    CHECK_FAILURE(webview->add_DocumentTitleChanged(Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
        [this](ICoreWebView2 *sender, IUnknown *args) -> HRESULT
    {
        wil::unique_cotaskmem_string title;
        CHECK_FAILURE(sender->get_DocumentTitle(&title));
        SetWindowText(hwnd, title.get());
        return S_OK;
    }).Get(), nullptr));

#if 0
    // Initialize GDI+.
    ULONG_PTR gdiplusToken;
    Gdiplus::GdiplusStartupInput gdiplusStartupInput;
    Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    // Listen for window icon changes.
    // 
    // XXX: This is disabled because for some reason GetFavicon downscales the icon
    // to 16x16, which makes it pretty useless.  We currently only set this icon to
    // the application icon anyway, so this is disabled for now.
    auto m_webView2_15 = webview.try_query<ICoreWebView2_15>();
    CHECK_FAILURE(m_webView2_15->add_FaviconChanged(Callback<ICoreWebView2FaviconChangedEventHandler>(
        [this](ICoreWebView2 *sender, IUnknown *args) -> HRESULT
    {
        Microsoft::WRL::ComPtr<ICoreWebView2_15> webview2;
        CHECK_FAILURE(sender->QueryInterface(IID_PPV_ARGS(&webview2)));

        // Get the new icon URL.
        wil::unique_cotaskmem_string url;
        CHECK_FAILURE(webview2->get_FaviconUri(&url));
        std::wstring strUrl(url.get());

        // Read the icon.
        webview2->GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
            Callback<ICoreWebView2GetFaviconCompletedHandler>(
            [this, strUrl](HRESULT errorCode, IStream* iconStream) -> HRESULT
        {
            CHECK_FAILURE(errorCode);

            // Convert the PNG to an HICON.
            Gdiplus::Bitmap iconBitmap(iconStream);

            // printf("%i %i\n", iconBitmap.GetWidth(), iconBitmap.GetHeight());
            /*
            Gdiplus::Bitmap icon32x32(32, 32);
            {
                Gdiplus::Graphics graphics(&icon32x32);
                graphics.ScaleTransform(
                    float(icon32x32.GetWidth()) / iconBitmap.GetWidth(),
                    float(icon32x32.GetHeight()) / iconBitmap.GetHeight());
                graphics.DrawImage(&iconBitmap, 0, 0);
            }
            */

            wil::unique_hicon icon;
            auto gdiResult = iconBitmap.GetHICON(&icon);
            if(gdiResult != Gdiplus::Status::Ok)
            {
                // If we can't read the new icon, leave the old one alone.
                return S_OK;
            }

            // Store the new icon and set it.
            // XXX: this gives a low-res alt-tab icon for some reason
            wil::unique_hicon windowIcon = std::move(icon);
            SendMessage(hwnd, WM_SETICON, ICON_BIG, (LPARAM) windowIcon.get());

            return S_OK;
        }).Get());

        return S_OK;
    }).Get(), nullptr));
#endif

    // Disable permission prompts.  They're not relevant since this isn't a real browser
    // environment.  This API is incomplete and doesn't include some important things, like
    // external protocol prompts.
    CHECK_FAILURE(webview->add_PermissionRequested(
        Callback<ICoreWebView2PermissionRequestedEventHandler>(
        [this](ICoreWebView2* sender, ICoreWebView2PermissionRequestedEventArgs* args)
    {
        CHECK_FAILURE(args->put_State(COREWEBVIEW2_PERMISSION_STATE_ALLOW));
        return S_OK;
    }).Get(), nullptr));

    // Listen for and override vviewinexplorer scheme navigations.
    CHECK_FAILURE(webview->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
        [this](ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT
    {
        wchar_t *urlPtr = nullptr;
        CHECK_FAILURE(args->get_Uri(&urlPtr));
        std::wstring url(urlPtr);

        // The custom vview scheme is used to open paths in Explorer from the web UI when
        // it's running in a regular browser.  Intercept this here and handle it directly.
        // This fixes a couple problems:
        // 
        // - WebView2's ICoreWebView2PermissionRequestedEventHandler is broken and isn't
        // called for external protocols, so users get annoying "allow external program"
        // prompts which shouldn't happen when we're running in our own browser window.
        // 
        // - The Explorer window doesn't always get focus, since Windows is overzealous
        // about protecting focus and it doesn't understand that the server task opening
        // a window really is coming from a user action.
        //
        // For the normal browser path, see vview.shell.vview_scheme in the server.
        //
        // Extract the query string.
        wil::com_ptr<IUri> urlObject;
        CreateUri(url.c_str(),
            Uri_CREATE_CANONICALIZE | Uri_CREATE_NO_DECODE_EXTRA_INFO | Uri_CREATE_NO_ENCODE_FORBIDDEN_CHARACTERS, 0,
            &urlObject);

        wil::unique_bstr scheme;
        urlObject->GetSchemeName(&scheme);
        if(wcscmp(scheme.get(), L"vview"))
            return S_OK;

        wil::unique_bstr host;
        urlObject->GetHost(&host);
        if(wcscmp(host.get(), L"view-in-explorer"))
            return S_OK;

        // Cancel the navigation and handle it directly now that we know we recognize it.
        args->put_Cancel(true);

        wil::unique_bstr query;
        urlObject->GetQuery(&query);

        // A separate API to get the unescaped path?  Surely there's a better API to do all this.
        wchar_t decodedPath[INTERNET_MAX_URL_LENGTH];
        DWORD decodedPathSize = sizeof(decodedPath);

        HRESULT hr = UrlUnescape(const_cast<wchar_t *>(query.get()), decodedPath, &decodedPathSize, URL_UNESCAPE_AS_UTF8);

        wchar_t *path2 = decodedPath;
        if(wcslen(path2) == 0)
            return S_OK;

        // Work around Explorer being the only Windows application that doesn't understand
        // that paths can have forward slashes.
        for(wchar_t *p = path2; *p; ++p)
            if(*p == '/')
                *p = '\\';

        // Show the path in Explorer.
        wstring command = L"explorer.exe /select, ";
        command += L"\"";
        command += path2 + 1; // skip ?
        command += L"\"";

        STARTUPINFOW si = {};
        si.cb = sizeof(si);

        PROCESS_INFORMATION pi = {};
        CreateProcess(nullptr, const_cast<wchar_t *>(command.c_str()), nullptr, nullptr,
            false, 0, nullptr, nullptr, &si, &pi);

        return S_OK;
    }).Get(), nullptr));

    CHECK_FAILURE(controller->add_AcceleratorKeyPressed(Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
        [this](
            ICoreWebView2Controller* sender,
            ICoreWebView2AcceleratorKeyPressedEventArgs *args) -> HRESULT
    {
        // Only handle down events:
        COREWEBVIEW2_KEY_EVENT_KIND kind;
        CHECK_FAILURE(args->get_KeyEventKind(&kind));
        switch(kind)
        {
        case COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN:
        case COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN:
            break;
        default:
            return S_OK;
        }

        // Get the key.
        UINT key;
        CHECK_FAILURE(args->get_VirtualKey(&key));

        // Check if the key is one we want to handle.
        std::function<void()> action = GetHotkey(key);
        if(action == nullptr)
            return S_OK;

        CHECK_FAILURE(args->put_Handled(true));

        // Ignore repeats:
        COREWEBVIEW2_PHYSICAL_KEY_STATUS status;
        CHECK_FAILURE(args->get_PhysicalKeyStatus(&status));
        if (status.WasKeyDown)
            return S_OK;

        // Queue this to run async.
        RunAsync(action);
        return S_OK;
    }).Get(), nullptr));

    // window.open():
    CHECK_FAILURE(webview->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
        [this](ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args)
    {
        wil::com_ptr<ICoreWebView2Deferral> deferral;
        CHECK_FAILURE(args->GetDeferral(&deferral));

        wil::com_ptr<ICoreWebView2WindowFeatures> windowFeatures;
        CHECK_FAILURE(args->get_WindowFeatures(&windowFeatures));

        Config windowConfig = config;
        // Don't inherit the window size of the parent.
        config.fitWidth = config.fitHeight = -1;

        /*
        BOOL hasPosition = false;
        CHECK_FAILURE(windowFeatures->get_HasPosition(&hasPosition));

        BOOL hasSize = false;
        CHECK_FAILURE(windowFeatures->get_HasSize(&hasSize));

        windowConfig.setsWindowSize = hasPosition && hasSize;
        if(windowConfig.setsWindowSize)
        {
            UINT32 left = 0, top = 0, height = 0, width = 0;
            CHECK_FAILURE(windowFeatures->get_Left(&left));
            CHECK_FAILURE(windowFeatures->get_Top(&top));
            CHECK_FAILURE(windowFeatures->get_Height(&height));
            CHECK_FAILURE(windowFeatures->get_Width(&width));

            windowConfig.windowRect.left = left;
            windowConfig.windowRect.right = left + width;
            windowConfig.windowRect.top = top;
            windowConfig.windowRect.bottom = top + height;
        }
        */

        // Don't navigate the new window, the browser will do that itself.
        windowConfig.url.clear();

        config.onInitializationComplete = [args, deferral](VVbrowserWindow *self) {
            CHECK_FAILURE(args->put_NewWindow(self->webview.get()));
            CHECK_FAILURE(args->put_Handled(true));
            CHECK_FAILURE(deferral->Complete());
        };

        new VVbrowserWindow(windowConfig);
        return S_OK;
    }).Get(), nullptr));

    // window.close.  We allow ourself to close the window.
    CHECK_FAILURE(webview->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>([this](
        ICoreWebView2* sender, IUnknown* args)
    {
        CloseAppWindow();
        return S_OK;
    }).Get(), nullptr));

    // Fatal error handling:
    CHECK_FAILURE(webview->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>(this, &VVbrowserWindow::HandleWebViewError).Get(), nullptr));
}

HRESULT VVbrowserWindow::HandleWebViewError(ICoreWebView2 *sender, ICoreWebView2ProcessFailedEventArgs *args)
{
    COREWEBVIEW2_PROCESS_FAILED_KIND kind;
    CHECK_FAILURE(args->get_ProcessFailedKind(&kind));

    RunAsync([this, kind]() {
        // If true, we'll restart the WebView.  If false, we'll just reload it.
        bool justReload = false;
        const wchar_t *title = L"Application not responding";
        const wchar_t *message = L"";
        switch(kind)
        {
        case COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED:
            message = L"The browser process exited unexpectedly.  Restart?";
            title = L"Browser process exited";
            break;
        case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE:
            message = L"The render process is unresponsive.  Restart?";
            break;
        case COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED:
        case COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED:
            justReload = true;
            message = L"A render process exited unexpectedly. Restart?";
            break;
        default:
            message = L"A browser backend process exited unexpectedly. Restart?";
            break;
        }

        // Prompt to reload or restart.
        //
        // We could just go ahead and reload, but we want to make sure we don't get stuck
        // restarting endlessly if something is broken on the browser side.
        int result = MessageBox(hwnd, message, title, MB_YESNO);
        if(result != IDYES)
            return S_OK;

        if(justReload)
            CHECK_FAILURE(webview->Reload());
        else
            InitializeWebView();

        return S_OK;
    });

    return S_OK;
}

// Update the view size to match the window.
void VVbrowserWindow::SetWebViewSize()
{
    if(!controller)
        return;

    RECT rect = {0};
    GetClientRect(hwnd, &rect);
    controller->put_Bounds(rect);
}

// Close the WebView and deinitialize related state. This doesn't close the app window.
void VVbrowserWindow::CloseWebView()
{
    // Close the webview.
    if (controller)
    {
        controller->Close();
        controller = nullptr;
        webview = nullptr;
    }

    webviewEnvironment = nullptr;
}

void VVbrowserWindow::CloseAppWindow()
{
    CloseWebView();
    DestroyWindow(hwnd);
}

void VVbrowserWindow::RunAsync(std::function<void()> callback)
{
    auto* task = new std::function<void()>(std::move(callback));
    PostMessage(hwnd, WM_APP_RUN_ASYNC_MESSAGE, reinterpret_cast<WPARAM>(task), 0);
}

void VVbrowserWindow::AsyncMessageBox(std::wstring message, std::wstring title)
{
    RunAsync([this, message = std::move(message), title = std::move(title)]
    {
        MessageBox(hwnd, message.c_str(), title.c_str(), MB_OK);
    });
}

bool VVbrowserWindow::IsFullscreen() const
{
    DWORD style = GetWindowLong(hwnd, GWL_STYLE);
    return !(style & WS_OVERLAPPEDWINDOW);
}

void VVbrowserWindow::EnterFullScreen()
{
    if(IsFullscreen())
        return;

    // Store the window size so we can restore it when we exit fullscreen.
    if(!GetWindowRect(hwnd, &windowSizeToRestore))
        return;

    // Enable borderless windowed mode.
    MONITORINFO monitorInfo = {sizeof(monitorInfo)};
    if(!GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &monitorInfo))
        return;

    DWORD style = GetWindowLong(hwnd, GWL_STYLE);
    SetWindowLong(hwnd, GWL_STYLE, style & ~WS_OVERLAPPEDWINDOW);

    SetWindowPos(
        hwnd, HWND_TOP, monitorInfo.rcMonitor.left, monitorInfo.rcMonitor.top,
        monitorInfo.rcMonitor.right - monitorInfo.rcMonitor.left,
        monitorInfo.rcMonitor.bottom - monitorInfo.rcMonitor.top,
        SWP_NOOWNERZORDER | SWP_FRAMECHANGED);

    // Clear the window, so we don't flash the default white background before the first paint.
    ClearWindow(hwnd);

    SetWebViewSize();

    if(webview)
        webview->ExecuteScript(L"window.dispatchEvent(new Event('fullscreenchange'));", nullptr);
}

void VVbrowserWindow::ExitFullScreen()
{
    if(!IsFullscreen())
        return;

    // Exit fullscreen, restoring the window size we had before enabling it.
    // If we clear WS_OVERLAPPEDWINDOW without resetting the window size first
    // the window can flicker in its fullscreen size before the resize takes effect,
    // but if we SetWindowPos first the window size will be wrong.  So, hide the
    // window while we set the new window style, apply the position, then unhide
    // it.
    DWORD style = GetWindowLong(hwnd, GWL_STYLE);
    style |= WS_OVERLAPPEDWINDOW;
    SetWindowLong(hwnd, GWL_STYLE, style & ~WS_VISIBLE);
    SetWindowPos(
        hwnd, NULL, windowSizeToRestore.left, windowSizeToRestore.top,
        windowSizeToRestore.right - windowSizeToRestore.left,
        windowSizeToRestore.bottom - windowSizeToRestore.top,
        SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    SetWindowLong(hwnd, GWL_STYLE, style);

    if(webview)
        webview->ExecuteScript(L"window.dispatchEvent(new Event('fullscreenchange'));", nullptr);
}

// XXX: move to Python
DWORD WINAPI VVbrowserWindow::DownloadAndInstallRuntime(void *lpParameter)
{
    int returnCode = 2;
    HRESULT hr = URLDownloadToFile(nullptr,
        L"https://go.microsoft.com/fwlink/p/?LinkId=2124703",
        L".\\MicrosoftEdgeWebview2Setup.exe", 0, 0);
    if(hr == S_OK)
    {
        // Either Package the WebView2 Bootstrapper with your app or download it using fwlink
        // Then invoke install at Runtime.
        SHELLEXECUTEINFO shExInfo = {0};
        shExInfo.cbSize = sizeof(shExInfo);
        shExInfo.fMask = SEE_MASK_NOASYNC;
        shExInfo.hwnd = 0;
        shExInfo.lpVerb = L"runas";
        shExInfo.lpFile = L"MicrosoftEdgeWebview2Setup.exe";
        shExInfo.lpParameters = L" /silent /install";
        shExInfo.lpDirectory = 0;
        shExInfo.nShow = 0;
        shExInfo.hInstApp = 0;

        returnCode = ShellExecuteEx(&shExInfo) != 0;
    }

    return 0;
}

void VVbrowserWindow::OpenBrowserWindow(const Config &config)
{
    new VVbrowserWindow(config);

    // This is always the first window on this thread, since we don't return to the caller
    // until all threads have exited.  Run the message loop until we're told to quit, which
    // normally happens when the last window on this thread exits.
    MSG msg;
    while(GetMessage(&msg, nullptr, 0, 0))
    {
        if (!IsDialogMessage(GetAncestor(msg.hwnd, GA_ROOT), &msg))
        {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }
}

/*
 * Original WebView2 sample code is:
 * 
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * 
 *    * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *    * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *    * The name of Microsoft Corporation, or the names of its contributors
 * may not be used to endorse or promote products derived from this
 * software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
