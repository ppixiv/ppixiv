var install_polyfills = function()
{
    // Work around GreaseMonkey frovolously removing GM_setValue and GM_getValue.
    if(window.GM_getValue == null)
    {
        window.GM_getValue = function(key)
        {
            key = "_ppixiv_" + key;

            var result = localStorage[key];
            if(result == null)
                return null;
            return JSON.parse(result);
        }

        window.GM_setValue = function(key, value)
        {
            key = "_ppixiv_" + key;

            var value = JSON.stringify(value);
            localStorage[key] = value;
        }
    }

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

