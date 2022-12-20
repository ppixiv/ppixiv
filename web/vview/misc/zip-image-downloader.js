// Download a ZIP, returning files as they download in the order they're stored
// in the ZIP.

// A wrapper for the clunky ReadableStream API that lets us do at basic
// thing that API forgot about: read a given number of bytes at a time.
class IncrementalReader
{
    constructor(reader, options={})
    {
        this.reader = reader;
        this.position = 0;

        // Check if this is an ArrayBuffer.  "reader instanceof ArrayBuffer" is
        // broken in Firefox (but what isn't?).
        if("byteLength" in reader)
        {
            this.inputBuffer = new Int8Array(reader);
            this.inputBufferFinished = true;
        }
        else
        {
            this.inputBuffer = new Int8Array(0);
            this.inputBufferFinished = false;
        }

        // If set, this is called with the current read position as we read data.
        this.onprogress = options.onprogress;
    }

    async read(bytes)
    {
        let buffer = new ArrayBuffer(bytes);

        let result = new Int8Array(buffer);
        let outputPos = 0;

        while(outputPos < bytes)
        {
            // See if we have leftover data in this.inputBuffer.
            if(this.inputBuffer.byteLength > 0)
            {
                // Create a view of the bytes we want to copy, then use set() to copy them to the
                // output.  This is just memcpy(), why can't you just set(buf, srcPos, srcLen, dstPos)?
                let copyBytes = Math.min(bytes-outputPos, this.inputBuffer.byteLength);
                let buf = new Int8Array(this.inputBuffer.buffer, this.inputBuffer.byteOffset, copyBytes);
                result.set(buf, outputPos);
                outputPos += copyBytes;

                // Remove the data we read from the buffer.  This is just making the view smaller.
                this.inputBuffer = new Int8Array(this.inputBuffer.buffer, this.inputBuffer.byteOffset + copyBytes);

                continue;
            }

            // If we need more data and there isn't any, we've passed EOF.
            if(this.inputBufferFinished)
                throw new Error("Incomplete file");

            let { value, done } = await this.reader.read();
            if(value == null)
                value = new Int8Array(0);

            this.inputBufferFinished = done;
            this.inputBuffer = value;
            if(value)
                this.position += value.length;

            if(this.onprogress)
                this.onprogress(this.position);
        };

        return buffer;
    }
}

export default class ZipImageDownloader
{
    constructor(url, options={})
    {
        this.url = url;

        // An optional AbortSignal.
        this.signal = options.signal;
        this.onprogress = options.onprogress;

        this.startPromise = this.start();
    }

    async start()
    {
        let response = await ppixiv.helpers.send_pixiv_request({
            method: "GET",
            url: this.url,
            responseType: "arraybuffer",
            signal: this.signal,
        });        

        // If this fails, the error was already logged.  The most common cause is being cancelled.
        if(response == null)
            return null;

        // We could also figure out progress from frame numbers, but doing it with the actual
        // amount downloaded is more accurate, and the server always gives us content-length.
        this.totalLength = response.headers.get("Content-Length");
        if(this.totalLength != null)
            this.totalLength = parseInt(this.totalLength);

        // Firefox is in the dark ages and can't stream data from fetch.  Fall back
        // on loading the whole body if we don't have getReader.
        let fetchReader;
        if(response.body.getReader)
            fetchReader = response.body.getReader();
        else
            fetchReader = await response.arrayBuffer();

        this.reader = new IncrementalReader(fetchReader, {
            onprogress: (position) => {
                if(this.onprogress && this.totalLength > 0)
                {
                    let progress = position / this.totalLength;
                    this.onprogress(progress);
                }
            }
        });
    }

    async getNextFrame()
    {
        // Wait for startPromise to complete, if it hasn't yet.
        await this.startPromise;

        if(this.reader == null)
            return null;
        
        // Read the local file header up to the filename.
        let header = await this.reader.read(30);
        let view = new DataView(header);

        // Check the header.
        let magic = view.getUint32(0, true);
        if(magic == 0x02014b50)
        {
            // Once we see the central directory, we're at the end.
            return null;
        }

        if(magic != 0x04034b50)
            throw Error("Unrecognized file");

        let compression = view.getUint16(8, true);
        if(compression != 0)
            throw Error("Unsupported compression method");
        
        // Get the variable field lengths, and skip over the rest of the local file headers.
        let fileSize = view.getUint32(22, true);
        let filenameSize = view.getUint16(26, true);
        let extraSize = view.getUint16(28, true);
        await this.reader.read(filenameSize);
        await this.reader.read(extraSize);

        // Read the file.
        let result = await this.reader.read(fileSize);

        // Read past the data descriptor if this file has one.
        let flags = view.getUint16(6, true);
        if(flags & 8)
        {
            let descriptor = await this.reader.read(16);
            let descriptorView = new DataView(descriptor);
            if(descriptorView.getUint32(0, true) != 0x08074b50)
                throw Error("Unrecognized file");
        }

        return result;
    }
}
