// Create an uncompressed ZIP from a list of files and filenames.

import crc32 from 'vview/util/crc32.js';
import struct from 'vview/util/struct.js';

export default class CreateZIP
{
    constructor(filenames, files)
    {
        if(filenames.length != files.length)
            throw "Mismatched array lengths";

        // Encode the filenames.
        let filenameBlobs = [];
        for(let i = 0; i < filenames.length; ++i)
        {
            let filename = new Blob([filenames[i]]);
            filenameBlobs.push(filename);
        }

        // Make CRC32s, and create blobs for each file.
        let blobs = [];
        let crc32s = [];
        for(let i = 0; i < filenames.length; ++i)
        {
            let data = files[i];
            let crc = crc32(new Int8Array(data));
            crc32s.push(crc);
            blobs.push(new Blob([data]));
        }

        let parts = [];
        let filePos = 0;
        let fileOffsets = [];
        for(let i = 0; i < filenames.length; ++i)
        {
            let filename = filenameBlobs[i];
            let data = blobs[i];
            let crc = crc32s[i];

            // Remember the position of the local file header for this file.
            fileOffsets.push(filePos);

            let localFileHeader = this.createLocalFileHeader(filename, data, crc);
            parts.push(localFileHeader);
            filePos += localFileHeader.size;

            // Add the data.
            parts.push(data);
            filePos += data.size;
        }

        // Create the central directory.
        let centralDirectoryPos = filePos;
        let centralDirectorySize = 0;
        for(let i = 0; i < filenames.length; ++i)
        {
            let filename = filenameBlobs[i];
            let data = blobs[i];
            let crc = crc32s[i];

            let fileOffset = fileOffsets[i];
            let centralRecord = this.createCentralDirectoryEntry(filename, data, fileOffset, crc);
            centralDirectorySize += centralRecord.size;
            parts.push(centralRecord);
        }

        let endCentralRecord = this.createEndCentral(filenames.length, centralDirectoryPos, centralDirectorySize);
        parts.push(endCentralRecord);
        return new Blob(parts, {
            "type": "application/zip",
        });
    }

    createLocalFileHeader(filename, file, crc)
    {
        let data = struct("<IHHHHHIIIHH").pack(
            0x04034b50, // local file header signature
            10, // version needed to extract
            0, // general purpose bit flag
            0, // compression method
            0, // last mod file time
            0, // last mod file date
            crc, // crc-32
            file.size, // compressed size
            file.size, // uncompressed size
            filename.size, // file name length
            0 // extra field length
        );

        return new Blob([data, filename]);
    };

    createCentralDirectoryEntry(filename, file, fileOffset, crc)
    {
        let data = struct("<IHHHHHHIIIHHHHHII").pack(
            0x02014b50, // central file header signature
            10, // version made by
            10, // version needed to extract
            0, // general purpose bit flag
            0, // compression method
            0, // last mod file time
            0, // last mod file date
            crc,
            file.size, // compressed size
            file.size, // uncompressed size
            filename.size, // file name length
            0, // extra field length
            0, // file comment length
            0, // disk number start
            0, // internal file attributes
            0, // external file attributes
            fileOffset // relative offset of local header
        );

        return new Blob([data, filename]);
    }

    createEndCentral(numFiles, centralDirectoryPos, centralDirectorySize)
    {
        let data = struct("<IHHHHIIH").pack(
            0x06054b50, // end of central dir signature
            0, // number of this disk
            0, // number of the disk with the start of the central directory
            numFiles, // total number of entries in the central directory on this disk
            numFiles, // total number of entries in the central directory
            centralDirectorySize, // size of the central directory
            centralDirectoryPos, // offset of start of central directory with respect to the starting disk number
            0 // .ZIP file comment length
        );
        return new Blob([data]);
    } 
}
