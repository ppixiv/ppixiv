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

    // This isn't really a polyfill, but we treat it like one for convenience.
    //
    // When functions called from event handlers throw exceptions, GreaseMonkey usually forgets
    // to log them to the console, probably sending them to some inconvenient browser-level log
    // instead.  Work around some of this.  func.catch_bind is like func.bind, but also wraps
    // the function in an exception handler to log errors correctly.  The exception will still
    // be raised.
    //
    // This is only needed in Firefox, and we just point it at bind() otherwise.
    if(navigator.userAgent.indexOf("Firefox") == -1)
    {
        Function.prototype.catch_bind = Function.prototype.bind;
    } else {
        Function.prototype.catch_bind = function()
        {
            var func = this;
            var self = arguments[0];
            var bound_args = Array.prototype.slice.call(arguments, 1);
            var wrapped_func = function()
            {
                try {
                    var called_args = Array.prototype.slice.call(arguments, 0);
                    var args = bound_args.concat(called_args);
                    return func.apply(self, args);
                } catch(e) {
                    console.error(e);
                    throw e;
                }
            };
            return wrapped_func;
        };
    }

    if(!("requestFullscreen" in Element.prototype))
    {
        // Web API prefixing needs to be shot into the sun.
        if("webkitRequestFullScreen" in Element.prototype)
        {
            Element.prototype.requestFullscreen = Element.prototype.webkitRequestFullScreen;
            HTMLDocument.prototype.exitFullscreen = HTMLDocument.prototype.webkitCancelFullScreen;
            Object.defineProperty(HTMLDocument.prototype, "fullscreenElement", {
                get: function() { return this.webkitFullscreenElement; }
            });
        }
        else if("mozRequestFullScreen" in Element.prototype)
        {
            Element.prototype.requestFullscreen = Element.prototype.mozRequestFullScreen;
            HTMLDocument.prototype.exitFullscreen = HTMLDocument.prototype.mozCancelFullScreen;
            Object.defineProperty(HTMLDocument.prototype, "fullscreenElement", {
                get: function() { return this.mozFullScreenElement; }
            });
        }
    }
}

