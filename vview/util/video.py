import asyncio, os, subprocess
from vview.util import misc

# This handles extracting a frame from videos for thumbnails and posters,
# and extracting the display resolution of videos.
#
# Is there a lightweight way of doing this?  FFmpeg is enormous and has
# nasty licensing.  We only need to support WebM and MP4, since those are
# the only formats that browsers will display anyway.
ffmpeg = './bin/ffmpeg/bin/ffmpeg'

class pipe_to_process:
    def __init__(self, input_file):
        self.input_file = input_file
        self.read, self.write = os.pipe()

    def __del__(self):
        if self.read is not None:
            os.close(self.read)
        if self.write is not None:
            os.close(self.write)

    async def send_and_wait(self, wait_promise):
        """
        Send data from the input file and wait for wait_promise to complete.
        Return the result of wait_promise.
        """
        # self.read should have been sent to the process.  Close our copy.
        os.close(self.read)
        self.read = None

        # Wait for all data to be sent and the process to exit.  If we're cancelled,
        # wait_or_kill_process will kill the process, which will also cause the writer
        # to receive BrokenPipeError and stop.
        send_promise = asyncio.create_task(asyncio.to_thread(self._send), name='Process pipe (send)')
        wait_promise = asyncio.create_task(wait_promise, name='Process pipe (wait)')

        waits = {send_promise, wait_promise}
        while waits:
            done, pending = await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
            waits -= done

        return wait_promise.result()

    def _send(self):
        # We should be able to just say "process.communicate(input=file)", but we can't.
        try:
            while True:
                data = self.input_file.read(1024*32)
                if len(data) == 0:
                    break

                os.write(self.write, data)
        except BrokenPipeError:
            # The process exited before we sent the whole file.  This is normal, since
            # we're using FFmpeg to grab frames from the start of the file.
            pass
        finally:
            # Close stdout now, or the process may not end.
            os.close(self.write)
            self.write = None

async def run_ffmpeg(args, stdin=None):
    args = list(args)
    args = [ffmpeg] + args
    
    # Use DETACHED_PROCESS so a console window isn't created.
    DETACHED_PROCESS = 0x00000008
    process = await asyncio.create_subprocess_exec(*args,
        stdin=stdin.read if stdin else subprocess.DEVNULL,
        creationflags=DETACHED_PROCESS)

    wait = misc.wait_or_kill_process(process)
    if stdin is not None:
        return await stdin.send_and_wait(wait)
    else:
        return await wait

async def extract_frame(input_file, output_file, seek_seconds, exif_description=None):
    # If input_file is a file on disk, give ffmpeg the filename so it can seek.  If it's
    # a stream (we're reading from a ZIP), feed it through stdin.
    input_path = input_file.real_file
    if input_path is None:
        input_path = '-'
        stdin = pipe_to_process(input_file.open('rb'))
    else:
        input_path = str(input_file)
        stdin = None
    args = [
        '-y',
        '-hide_banner',
        '-ss', str(seek_seconds),
        '-noaccurate_seek',
        '-loglevel', 'error',
        '-an', # disable audio
        '-i', input_path,
        '-frames:v', '1',
        '-pix_fmt', 'yuvj420p',
        output_file,
    ]
    result = await run_ffmpeg(args, stdin=stdin)

    # If the file is shorter than seek_seconds, ffmpeg will return success and just
    # not create the file.
    if result != 0 or not output_file.exists():
        return False

    return True
