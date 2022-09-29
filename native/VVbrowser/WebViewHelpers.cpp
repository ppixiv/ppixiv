// Copyright (C) Microsoft Corporation. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "WebViewHelpers.h"

#include <iomanip>
#include <sstream>
#include <pathcch.h>
#include <psapi.h>

// Notify the user of a failure with a message box.
void ShowFailure(HRESULT hr, const std::wstring& message)
{
    std::wstringstream formattedMessage;
    formattedMessage << message << ": 0x" << std::hex << std::setw(8) << hr;
    MessageBox(nullptr, formattedMessage.str().c_str(), nullptr, MB_OK);
}

// If something failed, show the error code and fail fast.
void CheckFailure(HRESULT hr, const std::wstring& message)
{
    if (FAILED(hr))
    {
        ShowFailure(hr, message);
        FAIL_FAST();
    }
}

std::wstring WebViewHelpers::ResolvePathAndTrimFile(std::wstring path)
{
    wchar_t resultPath[MAX_PATH];
    PathCchCanonicalize(resultPath, ARRAYSIZE(resultPath), path.c_str());
    PathCchRemoveFileSpec(resultPath, ARRAYSIZE(resultPath));
    return resultPath;
}

std::wstring WebViewHelpers::GetSdkBuild()
{
    auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    wil::unique_cotaskmem_string targetVersion;
    CHECK_FAILURE(options->get_TargetCompatibleBrowserVersion(&targetVersion));

    // The full version string A.B.C.D
    const wchar_t* targetVersionMajorAndRest = targetVersion.get();
    // Should now be .B.C.D
    const wchar_t* targetVersionMinorAndRest = wcschr(targetVersionMajorAndRest, L'.');
    CHECK_FAILURE((targetVersionMinorAndRest != nullptr && *targetVersionMinorAndRest == L'.') ? S_OK : E_UNEXPECTED);

    // Should now be .C.D
    const wchar_t* targetVersionBuildAndRest = wcschr(targetVersionMinorAndRest + 1, L'.');
    CHECK_FAILURE((targetVersionBuildAndRest != nullptr && *targetVersionBuildAndRest == L'.') ? S_OK : E_UNEXPECTED);

    // Return + 1 to skip the first . so just C.D
    return targetVersionBuildAndRest + 1;
}

std::wstring WebViewHelpers::GetAppPath()
{
    wchar_t appPath[MAX_PATH];
    GetModuleFileName(nullptr, appPath, ARRAYSIZE(appPath));
    return ResolvePathAndTrimFile(appPath);
}

std::wstring WebViewHelpers::ProcessFailedKindToString(const COREWEBVIEW2_PROCESS_FAILED_KIND kind)
{
#define KIND_ENTRY(kindValue) case kindValue: return L#kindValue;
    switch (kind)
    {
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_PLUGIN_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_BROKER_PROCESS_EXITED);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED);
    }
#undef KIND_ENTRY

    return L"PROCESS FAILED: " + std::to_wstring(static_cast<uint32_t>(kind));
}

std::wstring WebViewHelpers::ProcessFailedReasonToString(const COREWEBVIEW2_PROCESS_FAILED_REASON reason)
{
#define REASON_ENTRY(reasonValue) case reasonValue: return L#reasonValue;
    switch (reason)
    {
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED);
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE);
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED);
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED);
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED);
        REASON_ENTRY(COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY);
    }
#undef REASON_ENTRY

    return L"REASON: " + std::to_wstring(static_cast<uint32_t>(reason));
}

std::wstring WebViewHelpers::ProcessKindToString(const COREWEBVIEW2_PROCESS_KIND kind)
{
#define KIND_ENTRY(kindValue) case kindValue: return L#kindValue;
    switch (kind)
    {
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_BROWSER);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_RENDERER);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_UTILITY);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_SANDBOX_HELPER);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_GPU);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_PPAPI_PLUGIN);
        KIND_ENTRY(COREWEBVIEW2_PROCESS_KIND_PPAPI_BROKER);
    }
#undef KIND_ENTRY

    return L"PROCESS KIND: " + std::to_wstring(static_cast<uint32_t>(kind));
}
