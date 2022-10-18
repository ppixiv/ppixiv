import asyncio, logging
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

class AsyncTask:
    """
    An important use case with asyncs is mixing async and sync code.
    
    asyncio seems to want you to do this with to_thread, but that's a poor solution.  It's
    clunky to have to use it for every sync call, and it doesn't allow sync tasks to support
    cancellation.

    We do this in a better way: run the mixed task entirely in its own thread, so async
    code can call sync code directly without blocking the main event loop.  The sync code
    can periodically check for cancellation if wanted.
    """
    tasks = set()
    task_executor = ThreadPoolExecutor(max_workers=4)

    @classmethod
    def run(cls, task, *, name):
        """
        Run a background task.
        """
        result = cls()
        result.ran_task = False

        # Start _run_main_loop_task as a task in the caller's loop.  This can be awaited or cancelled
        # by the caller to await or cancel the threaded task.
        main_loop_task = result._run_main_loop_task(task, name=name)
        main_loop_task = asyncio.get_running_loop().create_task(main_loop_task, name=name)

        # Put the task on the task list to prevent it from being GC'd.
        cls.tasks.add(main_loop_task)
        def remove_when_done(_):
            cls.tasks.remove(main_loop_task)

            # If main_loop_task is cancelled before it starts, it'll never be run at all.  This is a design
            # bug in asyncio: it lets you catch CancelledError, but there's no way to handle cancellation
            # if it happens before the task is first called.  (It should always run the task until the first
            # time it awaits.)  This results in a spurious "was never awaited" warning.
            #
            # To work around this, manually cancel the coroutine by throwing CancelledError into it.  There's
            # also no way to tell if a coroutine has run: coroutines have three states (initial, running and
            # finished), but all that's exposed to the language is co_running, so "initial" and
            # "finished" look the same.  We track this ourself with result.ran_task.
            if not result.ran_task:
                try:
                    task.throw(asyncio.CancelledError())
                except asyncio.CancelledError as e:
                    # Discard the exception when it's propagated up to us.
                    pass

        main_loop_task.add_done_callback(remove_when_done)

        return main_loop_task

    async def _run_main_loop_task(self, task, *, name):
        log.info(f'Running task: {name}')

        self.ran_task = True
        self.was_cancelled = False
        self.name = name

        # Create our task loop.  This will run on a separate thread.  it's safe to do this here,
        # since the thread it'll run on isn't running yet.
        self.task_loop = asyncio.new_event_loop()
        self.task_loop.set_task_factory(_SyncCancellableTask)

        # Create a SyncCancellableTask task for the queued function.  The task will run in the task thread.
        self.task = self.task_loop.create_task(task, name=name)

        # Start the task.
        task_loop_task = asyncio.get_running_loop().run_in_executor(self.task_executor, self._run_task)

        # Create a future in the main loop, and finish it when task_loop_task is finished.
        future = asyncio.get_running_loop().create_future()
        def _cleanup_task(_):
            future.set_result(None)
        task_loop_task.add_done_callback(_cleanup_task)

        # Keep waiting until the task is actually cleaned up.  If we're cancelled, we'll cancel the
        # task then keep waiting until it's finished.
        while True:
            try:
                # Wait for the task to complete.  Shield this, so if we're cancelled it doesn't cause
                # the future to be cancelled.
                await asyncio.shield(future)
                break
            except asyncio.CancelledError as e:
                # If we're cancelled, cancel the task instead.
                self._cancel()

        # Clean up the task.
        log.info(f'Task {"cancelled" if self.was_cancelled else "finished"}: {self}')

        self.task_loop.close()
        self.task_loop = None

    def __str__(self):
        return f'QueuedTask({self.name})'

    def _cancel(self):
        """
        Ask the task to cancel.
        """
        # This is just for logging.
        self.was_cancelled = True

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
