#include "VVbrowserInterface.h"
#include "VVbrowserWindow.h"

// Note that WebView2 seems to mangle function names: it takes our capitalized
// function names here and transforms them into camel case.  I don't know why you'd
// ever do that, let alone to other peoples' APIs.

extern HINSTANCE DLLInstance;

VVbrowserInterface::VVbrowserInterface(VVbrowserWindow *window_)
{
    window = window_;
}

// We have to expose our own direct fullscreen interface, since WebView2's are broken:
// it's restricted by browser gesture restrictions with no way to turn it off (WebView2Feedback #944),
// and pressing escape exits fullscreen and throws it out of sync (#2770).
//
// chrome.webview.hostObjects.vvbrowser.setFullscreen
STDMETHODIMP VVbrowserInterface::SetFullscreen(BOOL value)
{
    if(value)
        window->EnterFullScreen();
    else
        window->ExitFullScreen();

    return S_OK;
}

// chrome.webview.hostObjects.vvbrowser.getFullscreen
STDMETHODIMP VVbrowserInterface::GetFullscreen(BOOL *value)
{
    *value = window->IsFullscreen();
    return S_OK;
}

// Nasty COM boilerplate:
STDMETHODIMP VVbrowserInterface::GetTypeInfoCount(UINT *pctinfo)
{
    *pctinfo = 1;
    return S_OK;
}

STDMETHODIMP VVbrowserInterface::GetTypeInfo(UINT iTInfo, LCID lcid, ITypeInfo **ppTInfo)
{
    if(iTInfo != 0)
        return TYPE_E_ELEMENTNOTFOUND;

    if(typeLib == nullptr)
    {
        wchar_t path[MAX_PATH] = {0};
        GetModuleFileName(DLLInstance, path, MAX_PATH);

        // Strip off the filename.
        *wcsrchr(path, '\\') = 0;
        wcscat(path, L"/VVbrowser.tlb");

        RETURN_IF_FAILED(LoadTypeLib(path, &typeLib));
    }

    return typeLib->GetTypeInfoOfGuid(__uuidof(IVVbrowserInterface), ppTInfo);
}

STDMETHODIMP VVbrowserInterface::GetIDsOfNames(REFIID riid, LPOLESTR *rgszNames, UINT cNames, LCID lcid, DISPID *rgDispId)
{
    wil::com_ptr<ITypeInfo> typeInfo;
    RETURN_IF_FAILED(GetTypeInfo(0, lcid, &typeInfo));
    return typeInfo->GetIDsOfNames(rgszNames, cNames, rgDispId);
}

STDMETHODIMP VVbrowserInterface::Invoke(
    DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags, DISPPARAMS *pDispParams,
    VARIANT *pVarResult, EXCEPINFO *pExcepInfo, UINT *puArgErr)
{
    wil::com_ptr<ITypeInfo> typeInfo;
    RETURN_IF_FAILED(GetTypeInfo(0, lcid, &typeInfo));
    return typeInfo->Invoke(
        this, dispIdMember, wFlags, pDispParams, pVarResult, pExcepInfo, puArgErr);
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
