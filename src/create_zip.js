"use strict";

// Create an uncompressed ZIP from a list of files and filenames.
this.create_zip = function(filenames, files)
{
    if(filenames.length != files.length)
        throw "Mismatched array lengths";

    // Encode the filenames.
    var filename_blobs = [];
    for(var i = 0; i < filenames.length; ++i)
    {
        var filename = new Blob([filenames[i]]);
        filename_blobs.push(filename);
    }

    // Make CRC32s, and create blobs for each file.
    var blobs = [];
    var crc32s = [];
    for(var i = 0; i < filenames.length; ++i)
    {
        var data = files[i];
        var crc = crc32(new Int8Array(data));
        crc32s.push(crc);
        blobs.push(new Blob([data]));
    }

    var parts = [];
    var file_pos = 0;
    var file_offsets = [];
    for(var i = 0; i < filenames.length; ++i)
    {
        var filename = filename_blobs[i];
        var data = blobs[i];
        var crc = crc32s[i];

        // Remember the position of the local file header for this file.
        file_offsets.push(file_pos);

        var local_file_header = this.create_local_file_header(filename, data, crc);
        parts.push(local_file_header);
        file_pos += local_file_header.size;

        // Add the data.
        parts.push(data);
        file_pos += data.size;
    }

    // Create the central directory.
    var central_directory_pos = file_pos;
    var central_directory_size = 0;
    for(var i = 0; i < filenames.length; ++i)
    {
        var filename = filename_blobs[i];
        var data = blobs[i];
        var crc = crc32s[i];

        var file_offset = file_offsets[i];
        var central_record = this.create_central_directory_entry(filename, data, file_offset, crc);
        central_directory_size += central_record.size;
        parts.push(central_record);
    }

    var end_central_record = this.create_end_central(filenames.length, central_directory_pos, central_directory_size);
    parts.push(end_central_record);
    return new Blob(parts, {
        "type": "application/zip",
    });
};

create_zip.prototype.create_local_file_header = function(filename, file, crc)
{
    var data = struct("<IHHHHHIIIHH").pack(
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

create_zip.prototype.create_central_directory_entry = function(filename, file, file_offset, crc)
{
    var data = struct("<IHHHHHHIIIHHHHHII").pack(
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
        file_offset // relative offset of local header
    );

    return new Blob([data, filename]);
}

create_zip.prototype.create_end_central = function(num_files, central_directory_pos, central_directory_size)
{
    var data = struct("<IHHHHIIH").pack(
        0x06054b50, // end of central dir signature
        0, // number of this disk
        0, // number of the disk with the start of the central directory
        num_files, // total number of entries in the central directory on this disk
        num_files, // total number of entries in the central directory
        central_directory_size, // size of the central directory
        central_directory_pos, // offset of start of central directory with respect to the starting disk number
        0 // .ZIP file comment length
    );
    return new Blob([data]);
} 
