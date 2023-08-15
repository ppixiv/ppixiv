#!/usr/bin/env python3
import asyncio, aiohttp, logging
from aiohttp import web

log = logging.getLogger(__name__)

# This WebSockets connection is used by LocalBroadcastChannel to send messages to
# clients in other browsers.

class WebsocketClientConnection:
    def __init__(self, request):
        self.request = request
        self.browser_id = None

    def __str__(self):
        return f'WebsocketClientConnection({self.browser_id})'

    async def run(self):
        self.ws = web.WebSocketResponse(heartbeat=30)
        await self.ws.prepare(self.request)

        self.websockets_connections = self.request.app['websockets_connections']

        # The first message from the client tells us its browser ID.
        init = await self.ws.receive_json()
        if init.get('command') != 'init':
            log.info('Expected init command from client')
            return

        self.browser_id = init.get('browser_id')

        # Set a better name for WebSockets tasks.
        # aiohttp doesn't set a name for the main task, so do it ourself.
        task = asyncio.current_task()
        task.set_name('WS-' + task.get_name())

        log.info(f'WebSockets connection opened ({self.request.remote}: {self.browser_id})')

        # Add ourself to the connection list, so we'll receive broadcasts from other clients.
        self.websockets_connections.add(self)

        close_code = aiohttp.WSCloseCode.OK
        close_message = 'Closing connection'
        try:
            await self.loop()
        except Exception as e:
            close_code = aiohttp.WSCloseCode.INTERNAL_ERROR
            close_message = f'Server error: {e}'
        finally:
            self.websockets_connections.remove(self)

            error = self.ws.exception() or 'Connection closed'
            log.info(f'WebSockets connection closed ({self.request.remote}: {self.browser_id}): {error}')

        # Close the connection if it's still open.
        await self.ws.close(code=close_code, message=close_message)

        return self.ws

    async def loop(self):
        async for msg in self.ws:
            if msg.type == aiohttp.WSMsgType.ERROR:
                break

            if msg.type != aiohttp.WSMsgType.TEXT:
                continue

            message = msg.json()
            command = message.get('command')
            if command == 'send-broadcast':
                await self.send_broadcast(message.get('message'))
            else:
                log.error(f'Unknown WebSockets message: {command}')
    
    async def send_broadcast(self, message):
        promises = []
        for client_connection in self.websockets_connections:
            # Don't send messages back to clients in the same browser.  They'll talk to
            # each other directly using a regular BroadcastChannel.
            if client_connection.browser_id == self.browser_id:
                continue

            promises.append(client_connection.ws.send_json({
                'command': 'receive-broadcast',
                'message': message,
            }))

        await asyncio.gather(*promises)

async def handle_websockets(request):
    connection = WebsocketClientConnection(request)
    return await connection.run()

def setup(app):
    app['websockets_connections'] = set()
    app.add_routes([web.get('/ws', handle_websockets)])
