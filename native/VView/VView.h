#ifndef VView_h
#define VView_h

// Run the VView.exe or VViewTerm.exe Python instance.  If terminal is true
// we're running VViewTerm (the console version), otherwise we're windowed.
extern "C" __declspec(dllexport) int RunVView(bool terminal);

#endif
