var install_polyfills = function()
{
    // Return true if name exists, eg. GM_xmlhttpRequest.
    var script_global_exists = function(name)
    {
        // For some reason, the script globals like GM and GM_xmlhttpRequest aren't
        // in window, so it's not clear how to check if they exist.  Just try to
        // access it and catch the ReferenceError exception if it doesn't exist.
        try {
            eval(name);
            return true;
        } catch(e) {
            return false;
        }
    };

    // If we have GM.xmlHttpRequest and not GM_xmlhttpRequest, set GM_xmlhttpRequest.
    if(script_global_exists("GM") && GM.xmlHttpRequest && !script_global_exists("GM_xmlhttpRequest"))
        window.GM_xmlhttpRequest = GM.xmlHttpRequest;

    // padStart polyfill:
    // https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart
    if(!String.prototype.padStart) {
        String.prototype.padStart = function padStart(targetLength,padString) {
            targetLength = targetLength>>0; //truncate if number or convert non-number to 0;
            padString = String((typeof padString !== 'undefined' ? padString : ' '));
            if (this.length > targetLength) {
                return String(this);
            }
            else {
                targetLength = targetLength-this.length;
                if (targetLength > padString.length) {
                    padString += padString.repeat(targetLength/padString.length); //append to original to ensure we are longer than needed
                }
                return padString.slice(0,targetLength) + String(this);
            }
        };
    }
}

