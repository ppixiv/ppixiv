/* pako/lib/zlib/crc32.js, MIT license: https://github.com/nodeca/pako/ */
var crc32 = (function() {
    // Use ordinary array, since untyped makes no boost here
    function makeTable() {
        var c, table = [];

        for(var n =0; n < 256; n++){
            c = n;
            for(var k =0; k < 8; k++){
                c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[n] = c;
        }

        return table;
    }

    // Create table on load. Just 255 signed longs. Not a problem.
    var crcTable = makeTable();

    return function(buf) {
        var crc = 0;
        var t = crcTable, end = buf.length;

        crc = crc ^ (-1);

        for (var i = 0; i < end; i++ ) {
            crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
        }

        return (crc ^ (-1)); // >>> 0;
    };
})();

