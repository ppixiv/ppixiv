// pako/lib/zlib/crc32.js, MIT license: https://github.com/nodeca/pako/
let crcTable = [];
for(let n = 0; n < 256; n++)
{
    let c = n;
    for(let k = 0; k < 8; k++)
        c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));

    crcTable[n] = c;
}

export default function crc32(buf)
{
    let crc = 0 ^ (-1);
    for(let i = 0; i < buf.length; i++)
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];

    return crc ^ (-1); // >>> 0;
}
