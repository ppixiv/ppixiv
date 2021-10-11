"use strict";

// This is a simple hack to piece together an MJPEG MKV from a bunch of JPEGs.

ppixiv.encode_mkv = (function() {
    var encode_length = function(value)
    {
        // Encode a 40-bit EBML int.  This lets us encode 32-bit ints with no extra logic.
        return struct(">BI").pack(0x08, value);
    };

    var header_int = function(container, identifier, value)
    {
        container.push(new Uint8Array(identifier));
        var data = struct(">II").pack(0, value);
        var size = data.byteLength;
        container.push(encode_length(size));
        container.push(data);
    };

    var header_float = function(container, identifier, value)
    {
        container.push(new Uint8Array(identifier));
        var data = struct(">f").pack(value);
        var size = data.byteLength;
        container.push(encode_length(size));
        container.push(data);
    };

    var header_data = function(container, identifier, data)
    {
        container.push(new Uint8Array(identifier));
        container.push(encode_length(data.byteLength));
        container.push(data);
    };

    // Return the total size of an array of ArrayBuffers.
    var total_size = function(array)
    {
        var size = 0;
        for(var idx = 0; idx < array.length; ++idx)
        {
            var item = array[idx];
            size += item.byteLength;
        }
        return size;
    };

    var append_array = function(a1, a2)
    {
        var result = new Uint8Array(a1.byteLength + a2.byteLength);
        result.set(new Uint8Array(a1));
        result.set(new Uint8Array(a2), a1.byteLength);
        return result;
    };

    // Create an EBML block from an identifier and a list of Uint8Array parts.  Return a
    // single Uint8Array.
    var create_data_block = function(identifier, parts)
    {
        var identifier = new Uint8Array(identifier);
        var data_size = total_size(parts);
        var encoded_data_size = encode_length(data_size);
        var result = new Uint8Array(identifier.byteLength + encoded_data_size.byteLength + data_size);
        var pos = 0;

        result.set(new Uint8Array(identifier), pos);
        pos += identifier.byteLength;

        result.set(new Uint8Array(encoded_data_size), pos);
        pos += encoded_data_size.byteLength;

        for(var i = 0; i < parts.length; ++i)
        {
            var part = parts[i];
            result.set(new Uint8Array(part), pos);
            pos += part.byteLength;
        }

        return result;
    };

    // EBML data types
    var ebml_header = function()
    {
        var parts = [];
        header_int(parts, [0x42, 0x86], 1); // EBMLVersion
        header_int(parts, [0x42, 0xF7], 1); // EBMLReadVersion
        header_int(parts, [0x42, 0xF2], 4); // EBMLMaxIDLength
        header_int(parts, [0x42, 0xF3], 8); // EBMLMaxSizeLength
        header_data(parts, [0x42, 0x82], new Uint8Array([0x6D, 0x61, 0x74, 0x72, 0x6F, 0x73, 0x6B, 0x61])); // DocType ("matroska")
        header_int(parts, [0x42, 0x87], 4); // DocTypeVersion
        header_int(parts, [0x42, 0x85], 2); // DocTypeReadVersion
        return create_data_block([0x1A, 0x45, 0xDF, 0xA3], parts); // EBML
    };

    var ebml_info = function(duration)
    {
        var parts = [];
        header_int(parts, [0x2A, 0xD7, 0xB1], 1000000); // TimecodeScale
        header_data(parts, [0x4D, 0x80], new Uint8Array([120])); // MuxingApp ("x") (this shouldn't be mandatory)
        header_data(parts, [0x57, 0x41], new Uint8Array([120])); // WritingApp ("x") (this shouldn't be mandatory)
        header_float(parts, [0x44, 0x89], duration * 1000); // Duration (why is this a float?)
        return create_data_block([0x15, 0x49, 0xA9, 0x66], parts); // Info
    };

    var ebml_track_entry_video = function(width, height)
    {
        var parts = [];
        header_int(parts, [0xB0], width); // PixelWidth
        header_int(parts, [0xBA], height); // PixelHeight
        return create_data_block([0xE0], parts); // Video
    };

    var ebml_track_entry = function(width, height)
    {
        var parts = [];
        header_int(parts, [0xD7], 1); // TrackNumber
        header_int(parts, [0x73, 0xC5], 1); // TrackUID
        header_int(parts, [0x83], 1); // TrackType (video)
        header_int(parts, [0x9C], 0); // FlagLacing
        header_int(parts, [0x23, 0xE3, 0x83], 33333333); // DefaultDuration (overridden per frame)
        header_data(parts, [0x86], new Uint8Array([0x56, 0x5f, 0x4d, 0x4a, 0x50, 0x45, 0x47])); // CodecID ("V_MJPEG")
        parts.push(ebml_track_entry_video(width, height));
        return create_data_block([0xAE], parts); // TrackEntry
    };

    var ebml_tracks = function(width, height)
    {
        var parts = [];
        parts.push(ebml_track_entry(width, height));
        return create_data_block([0x16, 0x54, 0xAE, 0x6B], parts); // Tracks
    };

    var ebml_simpleblock = function(frame_data)
    {
        // We should be able to use encode_length(1), but for some reason, while everything else
        // handles our non-optimal-length ints just fine, this field doesn't.  Manually encode it
        // instead.
        var result = new Uint8Array([
            0x81, // track number 1 (EBML encoded)
            0, 0, // timecode relative to cluster
            0x80, // flags (keyframe)
        ]); 

        result = append_array(result, frame_data);
        return result;
    };

    var ebml_cluster = function(frame_data, frame_time)
    {
        var parts = [];
        header_int(parts, [0xE7], Math.round(frame_time * 1000)); // Timecode

        header_data(parts, [0xA3], ebml_simpleblock(frame_data)); // SimpleBlock

        return create_data_block([0x1F, 0x43, 0xB6, 0x75], parts); // Cluster
    };

    var ebml_cue_track_positions = function(file_position)
    {
        var parts = [];
        header_int(parts, [0xF7], 1); // CueTrack
        header_int(parts, [0xF1], file_position); // CueClusterPosition
        return create_data_block([0xB7], parts); // CueTrackPositions
    };

    var ebml_cue_point = function(frame_time, file_position)
    {
        var parts = [];
        header_int(parts, [0xB3], Math.round(frame_time * 1000)); // CueTime
        parts.push(ebml_cue_track_positions(file_position));

        return create_data_block([0xBB], parts); // CuePoint
    };

    var ebml_cues = function(frame_times, frame_file_positions)
    {
        var parts = [];
        for(var frame = 0; frame < frame_file_positions.length; ++frame)
        {
            var frame_time = frame_times[frame];
            var file_position = frame_file_positions[frame];
            parts.push(ebml_cue_point(frame_time, file_position));
        }

        return create_data_block([0x1C, 0x53, 0xBB, 0x6B], parts); // Cues
    };

    var ebml_segment = function(parts)
    {
        return create_data_block([0x18, 0x53, 0x80, 0x67], parts); // Segment
    };

    // API:
    // We don't decode the JPEG frames while we do this, so the resolution is supplied here.
    class encode_mkv
    {
        constructor(width, height)
        {
            this.width = width;
            this.height = height;
            this.frames = [];
        }

        add(jpeg_data, frame_duration_ms)
        {
            this.frames.push({
                data: jpeg_data,
                duration: frame_duration_ms,
            });
        };

        build()
        {
            // Sum the duration of the video.
            var duration = 0;
            for(var frame = 0; frame < this.frames.length; ++frame)
            {
                var data = this.frames[frame].data;
                var ms = this.frames[frame].duration;
                duration += ms / 1000.0;
            }

            var header_parts = ebml_header();

            var parts = [];
            parts.push(ebml_info(duration));
            parts.push(ebml_tracks(this.width, this.height));

            // current_pos is the relative position from the start of the segment (after the ID and
            // size bytes) to the beginning of the cluster.
            var current_pos = 0;
            for(var part of parts)
                current_pos += part.byteLength;

            // Create each frame as its own cluster, and keep track of the file position of each.
            var frame_file_positions = [];
            var frame_file_times = [];

            var frame_time = 0;
            for(var frame = 0; frame < this.frames.length; ++frame)
            {
                var data = this.frames[frame].data;
                var ms = this.frames[frame].duration;
                var cluster = ebml_cluster(data, frame_time);
                parts.push(cluster);

                frame_file_positions.push(current_pos);
                frame_file_times.push(frame_time);

                frame_time += ms / 1000.0;
                current_pos += cluster.byteLength;
            };

            // Add the frame index.
            parts.push(ebml_cues(frame_file_times, frame_file_positions));

            // Create an EBMLSegment containing all of the parts (excluding the header).
            var segment = ebml_segment(parts);

            // Return a blob containing the final data.
            var file = [];
            file = file.concat(header_parts);
            file = file.concat(segment);
            return new Blob(file);
        };
    };
    return encode_mkv;
})();
