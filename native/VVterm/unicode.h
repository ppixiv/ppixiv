#ifndef Unicode_H
#define Unicode_H

#include <string>
using namespace std;

// Encode a single UTF-8 character. Assumes that illegal characters (such as
// things in the surrogate range, or > 0x10FFFF) have already been removed.
size_t encode_utf8(void *output, unsigned long ch);

wstring codepage_to_wstring(int codepage, string s);
wstring utf8_to_wstring(string s);
string wstring_to_codepage(int codepage, wstring s);
string wstring_to_utf8(wstring s);

wchar_t xlat_uskbd2cyrllic(int ch);
int check_compose(int first, int second);

#endif

