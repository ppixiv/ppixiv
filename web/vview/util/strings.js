// General string helpers.

// Return the extension from a filename without the leading period.
export function getExtension(fn)
{
    let parts = fn.split(".");
    return parts[parts.length-1];
}

// Format a Date as a date and time string.
export function dateToString(date)
{
    date = new Date(date);
    let day = date.toLocaleDateString();
    let time = date.toLocaleTimeString();
    return day + " " + time;
}

// Convert a string to title case.
export function titleCase(s)
{
    let parts = [];
    for(let part of s.split(" "))
        parts.push(part.substr(0, 1).toUpperCase() + s.substr(1));
    return parts.join(" ");
}

// Format a duration in seconds as MM:SS or HH:MM:SS.
export function formatSeconds(totalSeconds)
{
    totalSeconds = Math.floor(totalSeconds);

    let result = "";
    let seconds = totalSeconds % 60; totalSeconds = Math.floor(totalSeconds / 60);
    let minutes = totalSeconds % 60; totalSeconds = Math.floor(totalSeconds / 60);
    let hours = totalSeconds % 24;

    result = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    if(hours > 0)
    {
        // Pad minutes to two digits if we have hours.
        result = result.padStart(5, '0');

        result = hours + ":" + result;
    }

    return result;
}

// Format an age in seconds as a string:
//
// 120 -> 2 mins
// 7200 -> 2 hours
export function ageToString(seconds)
{
    // If seconds is negative, return a time in the future.
    let future = seconds < 0;
    if(future)
        seconds = -seconds;

    function to_plural(label, places, value)
    {
        let factor = Math.pow(10, places);
        let plural_value = Math.round(value * factor);
        if(plural_value > 1)
            label += "s";
            
        let result = value.toFixed(places) + " " + label;
        result += future? " from now":" ago";
        return result;
    };
    if(seconds < 60)
        return to_plural("sec", 0, seconds);
    let minutes = seconds / 60;
    if(minutes < 60)
        return to_plural("min", 0, minutes);
    let hours = minutes / 60;
    if(hours < 24)
        return to_plural("hour", 0, hours);
    let days = hours / 24;
    if(days < 30)
        return to_plural("day", 0, days);
    let months = days / 30;
    if(months < 12)
        return to_plural("month", 0, months);
    let years = months / 12;
    return to_plural("year", 1, years);
}

// Parse:
// 1     -> 1
// 1:2   -> 0.5
// null  -> null
// ""    -> null
export function parseRatio(value)
{
    if(value == null || value == "")
        return null;
    if(value.indexOf == null)
        return value;

    let parts = value.split(":", 2);
    if(parts.length == 1)
    {
        return parseFloat(parts[0]);
    }
    else
    {
        let num = parseFloat(parts[0]);
        let den = parseFloat(parts[1]);
        return num/den;
    }
}

// Parse:
// 1        -> [1,1]
// 1...2    -> [1,2]
// 1...     -> [1,null]
// ...2     -> [null,2]
// 1:2      -> [0.5, 0.5]
// 1:2...2  -> [0.5, 2]
// null     -> null
export function parseRange(range)
{
    if(range == null)
        return null;
        
    let parts = range.split("...");
    let min = parseRatio(parts[0]);
    let max = parseRatio(parts[1]);
    return [min, max];
}

// Return the last count parts of path.
export function getPathSuffix(path, count=2, remove_from_end=0, { remove_extension=true }={})
{
    let parts = path.split('/');
    parts = parts.splice(0, parts.length - remove_from_end);
    parts = parts.splice(parts.length-count); // take the last count parts

    let result = parts.join("/");
    if(remove_extension)
        result = result.replace(/\.[a-z0-9]+$/i, '');

    return result;
}

// Replace the given field in a URL path.
//
// If the path is "/a/b/c/d", "a" is 0 and "d" is 4.
export function setPathPart(url, index, value)
{
    url = new URL(url);

    // Split the path, and extend it if needed.
    let parts = url.pathname.split("/");

    // The path always begins with a slash, so the first entry in parts is always empty.
    // Skip it.
    index++;
    
    // Hack: If this URL has a language prefixed, like "/en/users", add 1 to the index.  This way
    // the caller doesn't need to check, since URLs can have these or omit them.
    if(parts.length > 1 && parts[1].length == 2)
        index++;
    
    // Extend the path if needed.
    while(parts.length < index)
        parts.push("");

    parts[index] = value;

    // If the value is empty and this was the last path component, remove it.  This way, we
    // remove the trailing slash from "/users/12345/".
    if(value == "" && parts.length == index+1)
        parts = parts.slice(0, index);

    url.pathname = parts.join("/");
    return url;
}

export function getPathPart(url, index, value)
{
    // The path always begins with a slash, so the first entry in parts is always empty.
    // Skip it.
    index++;

    let parts = url.pathname.split("/");
    if(parts.length > 1 && parts[1].length == 2)
        index++;
    
    return parts[index] || "";
}

// This makes a very rough guess for whether the given string contains CJK text.
export function containsAsianText(text)
{
    // Common CJK Unicode ranges
    const cjkRanges = [
        [0x4E00, 0x9FFF],  // CJK Unified Ideographs
        [0x3400, 0x4DBF],  // CJK Unified Ideographs Extension A
        [0x20000, 0x2A6DF], // CJK Unified Ideographs Extension B
        [0x2A700, 0x2B73F], // CJK Unified Ideographs Extension C
        [0x2B740, 0x2B81F], // CJK Unified Ideographs Extension D
        [0x2B820, 0x2CEAF], // CJK Unified Ideographs Extension E
        [0x2F00, 0x2FDF],  // Kangxi Radicals
        [0x2E80, 0x2EFF],  // CJK Radicals Supplement
        [0x3000, 0x303F],  // CJK Symbols and Punctuation
        [0x31C0, 0x31EF],  // CJK Strokes
        [0xF900, 0xFAFF],  // CJK Compatibility Ideographs
        [0xFE30, 0xFE4F],  // CJK Compatibility Forms
        [0xFF00, 0xFFEF],  // Halfwidth and Fullwidth Forms
        [0xAC00, 0xD7AF]   // Hangul Syllables (Korean)
    ];

    function isCJK(charCode)
    {
        return cjkRanges.some(([start, end]) => charCode >= start && charCode <= end);
    }

    for(let i = 0; i < text.length; i++)
    {
        if(isCJK(text.charCodeAt(i)))
            return true;
    }

    return false;
}
