import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { CONFIG } from './config.js';
import { roomStore } from './rooms.js';

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'orbital-artillery-server', rooms: roomStore.size }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CONFIG.clientOrigin,
    methods: ['GET', 'POST']
  }
});

io.on('connection', socket => {
  // Phase 0 only: connection lifecycle exists, gameplay protocol does not.
  console.info(`socket connected: ${socket.id}`);

  socket.on('disconnect', reason => {
    console.info(`socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(CONFIG.port, '0.0.0.0', () => {
  console.info(`Orbital Artillery server scaffold listening on :${CONFIG.port}`);
});
