// This is a simple hack to piece together an MJPEG MKV from a bunch of JPEGs.

import struct from '/vview/util/struct.js';

function encodeLength(value)
{
    // Encode a 40-bit EBML int.  This lets us encode 32-bit ints with no extra logic.
    return struct(">BI").pack(0x08, value);
};

function headerInt(container, identifier, value)
{
    container.push(new Uint8Array(identifier));
    let data = struct(">II").pack(0, value);
    let size = data.byteLength;
    container.push(encodeLength(size));
    container.push(data);
};

function headerFloat(container, identifier, value)
{
    container.push(new Uint8Array(identifier));
    let data = struct(">f").pack(value);
    let size = data.byteLength;
    container.push(encodeLength(size));
    container.push(data);
};

function headerData(container, identifier, data)
{
    container.push(new Uint8Array(identifier));
    container.push(encodeLength(data.byteLength));
    container.push(data);
};

// Return the total size of an array of ArrayBuffers.
function totalSize(array)
{
    let size = 0;
    for(let idx = 0; idx < array.length; ++idx)
    {
        let item = array[idx];
        size += item.byteLength;
    }
    return size;
};

function appendArray(a1, a2)
{
    let result = new Uint8Array(a1.byteLength + a2.byteLength);
    result.set(new Uint8Array(a1));
    result.set(new Uint8Array(a2), a1.byteLength);
    return result;
};

// Create an EBML block from an identifier and a list of Uint8Array parts.  Return a
// single Uint8Array.
function createDataBlock(identifier, parts)
{
    identifier = new Uint8Array(identifier);
    let dataSize = totalSize(parts);
    let encodedDataSize = encodeLength(dataSize);
    let result = new Uint8Array(identifier.byteLength + encodedDataSize.byteLength + dataSize);
    let pos = 0;

    result.set(new Uint8Array(identifier), pos);
    pos += identifier.byteLength;

    result.set(new Uint8Array(encodedDataSize), pos);
    pos += encodedDataSize.byteLength;

    for(let i = 0; i < parts.length; ++i)
    {
        let part = parts[i];
        result.set(new Uint8Array(part), pos);
        pos += part.byteLength;
    }

    return result;
};

// EBML data types
function ebmlHeader()
{
    let parts = [];
    headerInt(parts, [0x42, 0x86], 1); // EBMLVersion
    headerInt(parts, [0x42, 0xF7], 1); // EBMLReadVersion
    headerInt(parts, [0x42, 0xF2], 4); // EBMLMaxIDLength
    headerInt(parts, [0x42, 0xF3], 8); // EBMLMaxSizeLength
    headerData(parts, [0x42, 0x82], new Uint8Array([0x6D, 0x61, 0x74, 0x72, 0x6F, 0x73, 0x6B, 0x61])); // DocType ("matroska")
    headerInt(parts, [0x42, 0x87], 4); // DocTypeVersion
    headerInt(parts, [0x42, 0x85], 2); // DocTypeReadVersion
    return createDataBlock([0x1A, 0x45, 0xDF, 0xA3], parts); // EBML
};

function ebmlInfo(duration)
{
    let parts = [];
    headerInt(parts, [0x2A, 0xD7, 0xB1], 1000000); // TimecodeScale
    headerData(parts, [0x4D, 0x80], new Uint8Array([120])); // MuxingApp ("x") (this shouldn't be mandatory)
    headerData(parts, [0x57, 0x41], new Uint8Array([120])); // WritingApp ("x") (this shouldn't be mandatory)
    headerFloat(parts, [0x44, 0x89], duration * 1000); // Duration (why is this a float?)
    return createDataBlock([0x15, 0x49, 0xA9, 0x66], parts); // Info
};

function ebmlTrackEntryVideo(width, height)
{
    let parts = [];
    headerInt(parts, [0xB0], width); // PixelWidth
    headerInt(parts, [0xBA], height); // PixelHeight
    return createDataBlock([0xE0], parts); // Video
};

function ebmlTrackEntry(width, height)
{
    let parts = [];
    headerInt(parts, [0xD7], 1); // TrackNumber
    headerInt(parts, [0x73, 0xC5], 1); // TrackUID
    headerInt(parts, [0x83], 1); // TrackType (video)
    headerInt(parts, [0x9C], 0); // FlagLacing
    headerInt(parts, [0x23, 0xE3, 0x83], 33333333); // DefaultDuration (overridden per frame)
    headerData(parts, [0x86], new Uint8Array([0x56, 0x5f, 0x4d, 0x4a, 0x50, 0x45, 0x47])); // CodecID ("V_MJPEG")
    parts.push(ebmlTrackEntryVideo(width, height));
    return createDataBlock([0xAE], parts); // TrackEntry
};

function ebmlTracks(width, height)
{
    let parts = [];
    parts.push(ebmlTrackEntry(width, height));
    return createDataBlock([0x16, 0x54, 0xAE, 0x6B], parts); // Tracks
};

function ebmlSimpleblock(frameData)
{
    // We should be able to use encodeLength(1), but for some reason, while everything else
    // handles our non-optimal-length ints just fine, this field doesn't.  Manually encode it
    // instead.
    let result = new Uint8Array([
        0x81, // track number 1 (EBML encoded)
        0, 0, // timecode relative to cluster
        0x80, // flags (keyframe)
    ]); 

    result = appendArray(result, frameData);
    return result;
};

function ebmlCluster(frameData, frameTime)
{
    let parts = [];
    headerInt(parts, [0xE7], Math.round(frameTime * 1000)); // Timecode

    headerData(parts, [0xA3], ebmlSimpleblock(frameData)); // SimpleBlock

    return createDataBlock([0x1F, 0x43, 0xB6, 0x75], parts); // Cluster
};

function ebmlCueTrackPositions(filePosition)
{
    let parts = [];
    headerInt(parts, [0xF7], 1); // CueTrack
    headerInt(parts, [0xF1], filePosition); // CueClusterPosition
    return createDataBlock([0xB7], parts); // CueTrackPositions
};

function ebmlCuePoint(frameTime, filePosition)
{
    let parts = [];
    headerInt(parts, [0xB3], Math.round(frameTime * 1000)); // CueTime
    parts.push(ebmlCueTrackPositions(filePosition));

    return createDataBlock([0xBB], parts); // CuePoint
};

function ebmlCues(frameTimes, frameFilePositions)
{
    let parts = [];
    for(let frame = 0; frame < frameFilePositions.length; ++frame)
    {
        let frameTime = frameTimes[frame];
        let filePosition = frameFilePositions[frame];
        parts.push(ebmlCuePoint(frameTime, filePosition));
    }

    return createDataBlock([0x1C, 0x53, 0xBB, 0x6B], parts); // Cues
};

function ebmlSegment(parts)
{
    return createDataBlock([0x18, 0x53, 0x80, 0x67], parts); // Segment
};

export default class EncodeMKV
{
    // We don't decode the JPEG frames while we do this, so the resolution is supplied here.
    constructor(width, height)
    {
        this.width = width;
        this.height = height;
        this.frames = [];
    }

    add(data, duration)
    {
        this.frames.push({ data, duration });
    };

    build()
    {
        // Sum the duration of the video.
        let totalDuration = 0;
        for(let frame = 0; frame < this.frames.length; ++frame)
        {
            let { duration } = this.frames;
            totalDuration += duration / 1000.0;
        }

        let headerParts = ebmlHeader();

        let parts = [];
        parts.push(ebmlInfo(totalDuration));
        parts.push(ebmlTracks(this.width, this.height));

        // currentPos is the relative position from the start of the segment (after the ID and
        // size bytes) to the beginning of the cluster.
        let currentPos = 0;
        for(let part of parts)
            currentPos += part.byteLength;

        // Create each frame as its own cluster, and keep track of the file position of each.
        let frameFilePositions = [];
        let frameFileTimes = [];

        let frameTime = 0;
        for(let frame = 0; frame < this.frames.length; ++frame)
        {
            let data = this.frames[frame].data;
            let ms = this.frames[frame].duration;
            let cluster = ebmlCluster(data, frameTime);
            parts.push(cluster);

            frameFilePositions.push(currentPos);
            frameFileTimes.push(frameTime);

            frameTime += ms / 1000.0;
            currentPos += cluster.byteLength;
        };

        // Add the frame index.
        parts.push(ebmlCues(frameFileTimes, frameFilePositions));

        // Create an EBMLSegment containing all of the parts (excluding the header).
        let segment = ebmlSegment(parts);

        // Return a blob containing the final data.
        let file = [];
        file = file.concat(headerParts);
        file = file.concat(segment);
        return new Blob(file);
    }
}
