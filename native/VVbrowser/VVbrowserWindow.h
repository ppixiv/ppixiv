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
#include "VVbrowserInterface.h"

class VVbrowserWindow
{
    friend class VVbrowserInterface;

public:
    struct Config
    {
        std::wstring url;
        std::wstring profilePath;
        std::wstring windowTitle = L"VView";

        // The size of an image that will be viewed.  If set, we'll choose window dimensions
        // that fits an image of this size.
        int fitWidth = -1, fitHeight = -1;

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
    wil::com_ptr<VVbrowserInterface> m_vvBrowserInterface;
};

#endif
