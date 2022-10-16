#ifndef VVbrowserInterfaceImpl_h
#define VVbrowserInterfaceImpl_h

#include <functional>
#include <string>
#include <wrl/client.h>

#include <wil/com.h>
#include <wil/resource.h>
#include <wil/result.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <wrl.h>

#include "VVbrowserInterface_h.h"

class VVbrowserWindow;
class VVbrowserInterface: public Microsoft::WRL::RuntimeClass<
                               Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
                               IVVbrowserInterface, IDispatch>
{
public:
    VVbrowserInterface(VVbrowserWindow *window);

    // IVVbrowserInterface:
    STDMETHODIMP SetFullscreen(BOOL value) override;
    STDMETHODIMP GetFullscreen(BOOL *value) override;

    // IDispatch:
    STDMETHODIMP GetTypeInfoCount(UINT* pctinfo) override;
    STDMETHODIMP GetTypeInfo(UINT iTInfo, LCID lcid, ITypeInfo** ppTInfo) override;
    STDMETHODIMP GetIDsOfNames(REFIID riid, LPOLESTR* rgszNames, UINT cNames, LCID lcid, DISPID* rgDispId) override;
    STDMETHODIMP Invoke(
        DISPID dispIdMember, REFIID riid, LCID lcid, WORD wFlags, DISPPARAMS* pDispParams,
        VARIANT* pVarResult, EXCEPINFO* pExcepInfo, UINT* puArgErr) override;

private:
    wil::com_ptr<ITypeLib> typeLib;
    VVbrowserWindow *window;
};

#endif
