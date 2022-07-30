import asyncio, logging
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

class AsyncTaskQueue:
    """
    An important use case with asyncs is mixing async and sync code.
    
    asyncio seems to want you to do this with to_thread, but that's a poor solution.  It's
    clunky to have to use it for every sync call, and it doesn't allow sync tasks to support
    cancellation.

    We do this in a better way: run the mixed task entirely in its own thread, so async
    code can call sync code directly without blocking the main event loop.  The sync code
    can periodically check for cancellation if wanted.
    """

    def __init__(self):
        self.running_background_tasks = {}
        self.task_executor = ThreadPoolExecutor(max_workers=1)
        self.next_background_task_id = 0

    def run_task(self, task, *, name=None):
        """
        Register a background task.
        """
        task_id = self.next_background_task_id
        self.next_background_task_id += 1

        log.info(f'Running task: {name}')

        def oncomplete():
            del self.running_background_tasks[task_id]

        queued_task = _QueuedTask(name, task, oncomplete)
        self.running_background_tasks[task_id] = queued_task
        
        queued_task.run(self.task_executor)
        return task_id

    async def shutdown(self):
        await self.cancel_tasks()

    async def cancel_tasks(self):
        """
        Cancel all running and pending tasks, and wait for them to stop.
        """
        if not self.running_background_tasks:
            return

        # Make a copy of running_background_tasks, so we don't get confused if new tasks
        # are queued while we're doing this.
        tasks = dict(self.running_background_tasks)

        for task_id, queued_task in tasks.items():
            log.info(f'Cancelling background task {task_id}: {queued_task.task.get_name()}')
            queued_task.cancel()

        # Wait for the tasks to finish cancelling.
        for task_id, queued_task in tasks.items():
            log.info(f'Waiting for task {queued_task} to complete')
            await queued_task.wait()

class _QueuedTask:
    def __init__(self, name, task, oncomplete):
        self.finished = asyncio.Event()
        self.oncomplete = oncomplete

        # Create our task loop.  This will run on a separate thread.  it's safe to do this here,
        # since the thread it'll run on isn't running yet.
        self.task_loop = asyncio.new_event_loop()
        self.task_loop.set_task_factory(_SyncCancellableTask)

        # Create a task for the queued function.  The task will run in the task thread.  It's
        # safe to do this now in a different thread, since the task thread isn't running yet.
        self.task = self.task_loop.create_task(task, name=name)

    def __str__(self):
        return f'QueuedTask({self.task.get_name()})'

    def run(self, executor):
        """
        Start the task using the given executor.
        """
        self.task_loop_task = asyncio.get_running_loop().run_in_executor(executor, self._run_task)
        self.task_loop_task.add_done_callback(self._cleanup_task)

    def cancel(self):
        """
        Ask the task to cancel.
        """
        # cancel_sync marks the task as synchronously cancelled.  This allows sync code
        # checking for cancellation to tell it's been cancelled.  If we use Task.cancelled
        # for this , it won't see the cancellation since the cancel() call below won't actually
        # be executed until the event loop runs again.
        #
        # Do this first.  If the task hasn't actually started yet because we're out of worker
        # threads, the threads will start as previous workers are cancelled, and this allows
        # run_task to know that it's been cancelled and shouldn't run the task at all.
        self.task.cancel_sync()
        
        # Now ask the tasks to cancel normally.  This needs to be scheduled into the task
        # loop running this task.
        self.task_loop.call_soon_threadsafe(self.task.cancel)

    async def wait(self):
        """
        Wait until the task completes or finishes cancelling.
        """
        # If the task hasn't been completed yet, wait for it.
        if self.task_loop_task is not None:
            await self.task_loop_task

        # Wait for _cleanup_task to finish.
        await self.finished.wait()

        # cleanup_task should have cleaned up current_task_loop_task.
        assert self.task_loop_task is None

    def _run_task(self):
        if self.task.cancelled():
            # We were cancelled before we started, so don't run the task.
            log.info('Not running cancelled task')
            # self.task.cancel()
            return

        asyncio.set_event_loop(self.task_loop)
        try:
            self.task_loop.run_until_complete(self.task)
        except asyncio.CancelledError:
            pass
        except BaseException as e:
            log.exception(f'Task {self} raised exception')
        finally:
            asyncio.set_event_loop(None)

    def _cleanup_task(self, _):
        # This will be called in the main loop when the task completes.  Shut down and clean
        # up.
        log.info(f'Task finished: {self}')
        self.task_loop_task = None

        self.task_loop.close()
        self.task_loop = None

        self.finished.set()

        self.oncomplete()

class _SyncCancellableTask(asyncio.tasks.Task):
    def __init__(self, loop, coro):
        super().__init__(coro, loop=loop)
        self.sync_cancelled = False

    def cancel_sync(self):
        """
        Mark this task as cancelled.

        We want to be able to cancel a task both when it's running asynchronously, using
        Task.cancel, and if it's running synchronously and checking for cancellation periodically.
        When it's running sync, we have no way of safely calling Task.cancel.  It needs to be
        scheduled into the loop, but those won't run while code is blocking synchronously.

        cancel_sync works around this: we can call this from another thread without scheduling
        it into the current loop.  This won't trigger CancellationException, but will cause
        should_cancel() to return true, so sync code can check the task cancellation periodically.
        """
        self.sync_cancelled = True

    def should_cancel(self):
        return self.sync_cancelled or super().cancelled()

    def throw_if_cancelled(self):
        """
        Throw CancelledError if the task has been cancelled.

        This allows sync code to check for cancellation as if they've gone async and
        CancelledError was thrown.
        """
        if self.should_cancel():
            raise asyncio.CancelledError
