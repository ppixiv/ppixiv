#ifndef VVbrowserWindow_H
#define VVbrowserWindow_H

#include <functional>
#include <memory>
#include <string>
#include <vector>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <wrl.h>
#include <wil/com.h>
#include <wil/resource.h>
#include <wil/result.h>

#include "Webview2.h"
#include "WebView2EnvironmentOptions.h"

class VVbrowserWindow
{
public:
    struct Config
    {
        std::wstring url;
        std::wstring profilePath;
        std::wstring windowTitle = L"VView";

        // The size and position for the window, if setsWindowSize is true.  Otherwise, uses
        // the system default, which should remember the user's window positioning.
        int width = -1, height = -1;

        // If true, the window position will be adjusted proportionally to fit on the monitor.
        bool fitOnWindow = false;

        bool maximized = false;
        bool fullscreen = false;
        HICON defaultIcon = (HICON) INVALID_HANDLE_VALUE;

        // If set, this function will be called once the view has finished initializing.
        std::function<void(VVbrowserWindow *self)> onInitializationComplete;
    };

    // Open a VVbrowserWindow, blocking until all windows in this thread are closed.
    static void OpenBrowserWindow(const VVbrowserWindow::Config &config);

    static bool WebViewInstallationRequired();

private:
    VVbrowserWindow(Config config);

    std::function<void()> GetHotkey(UINT key);

    void RunAsync(std::function<void(void)> callback);
    void AsyncMessageBox(std::wstring message, std::wstring title);

    static PCWSTR GetWindowClass(HINSTANCE hinst);
    static LRESULT CALLBACK WndProcStatic(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT HandleWindowMessage(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);

    void InitializeWebView();
    void Suspend();
    void SetWebViewSize();

    HRESULT HandleWebViewError(ICoreWebView2 *sender, ICoreWebView2ProcessFailedEventArgs *argsRaw);
    HRESULT OnCreateEnvironmentCompleted(HRESULT result, ICoreWebView2Environment* environment);
    HRESULT OnCreateCoreWebView2ControllerCompleted(HRESULT result, ICoreWebView2Controller* controller);
    void AddCallbacks();
    void CloseWebView();
    void CloseAppWindow();

    bool IsFullscreen() const;
    void EnterFullScreen();
    void ExitFullScreen();

    static DWORD WINAPI DownloadAndInstallRuntime(void *lpParameter);

    Config config;
    HWND hwnd = nullptr;
    RECT windowSizeToRestore;

    // WebView2 interfaces:
    wil::com_ptr<ICoreWebView2_13> webview;
    wil::com_ptr<ICoreWebView2Controller2> controller;
    wil::com_ptr<ICoreWebView2Environment> webviewEnvironment;
};

#endif
