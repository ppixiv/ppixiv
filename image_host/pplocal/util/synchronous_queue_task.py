import asyncio, concurrent

class SynchronousQueueTask:
    """
    A queue for sending results from a non-async task running in a thread to
    an async caller.
    
    This is between queue.Queue and asyncio.Queue.  queue.Queue is synchronous
    at both ends, and asyncio.Queue is async at both ends.  This is synchronous
    for put() and asynchronous for get().  This also handles shutting down
    the task cleanly, and propagating exceptions from the task.
    """
    class ShutdownException(Exception): pass

    def __init__(self, maxsize=0):
        self.queue = asyncio.Queue(maxsize)
        self.task = None
        self.shutdown = False
        self.loop = asyncio.get_event_loop()

    def run(self, callable, *args):
        """
        Run callable() in a thread.
        """
        assert self.task is None, 'Task already created'
        self.task = asyncio.create_task(asyncio.to_thread(callable, *args))

    def put(self, data):
        """
        Put an item into the queue.  If the queue is full, block until space is
        available.

        If the task is cancelled, ShutdownException will be raised.  If the task
        raises an exception, it will be raised here.
        """
        if self.shutdown:
            raise self.ShutdownException('Queue was shut down')

        future = asyncio.run_coroutine_threadsafe(self.queue.put(data), self.loop)
        concurrent.futures.wait([future])

    async def get(self):
        """
        Remove and return an item from the queue, waiting until an item is available.

        If the task ends or is cancelled, return None.
        """
        # Wait for either an item from the queue or the task ending.
        get =  asyncio.create_task(self.queue.get())
        done, pending = await asyncio.wait([get, self.task], return_when=asyncio.FIRST_COMPLETED)
        if get in done:
            return await get

        # If get didn't finish, the task did.  Await it to propagate exceptions.
        assert self.task in done
        await self._await_task()

    async def cancel(self):
        """
        Cancel the task and wait for it to end.

        If the task is still running, calls to put() will raise ShutdownException to shut
        down the task.  If the task raises another exception, it will be raised here.
        """
        if self.shutdown:
            return

        self.shutdown = True

        # Get an item from the queue to wake up the task if it's blocking on put,
        # then wait for either the get or the task to complete.
        get = asyncio.create_task(self.queue.get())
        done, pending = await asyncio.wait([get, self.task], return_when=asyncio.FIRST_COMPLETED)

        # If the get completed and the task didn't, we know the thread was just woken
        # up by the get and will see self.shutdown the next time it tries to write anything,
        # so it's guaranteed to complete soon.
        return await self._await_task()

    async def _await_task(self):
        """
        Await the task and swallow any ShutdownExceptions.
        """
        try:
            return await self.task
        except self.ShutdownException:
            # The thread was shut down by cancel().
            return None

async def test():
    queue = SynchronousQueueTask()
    def create_output():
        queue.put('test 1')
        queue.put('test 2')

    queue.run(create_output)
    
    await queue.cancel()

    print('-> get')
    f = await queue.get()
    print('<- got:', f)

    print('-> get')
    f = await queue.get()
    print('<- got:', f)

if __name__ == '__main__':
    asyncio.run(test())
