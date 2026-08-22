import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { CONFIG } from './config.js';
import { roomStore } from './rooms.js';

const connectionWindows = new Map();

function clientIpFromRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function allowConnectionAttempt(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const current = connectionWindows.get(ip);

  if (!current || now - current.startedAt >= windowMs) {
    connectionWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  return current.count <= CONFIG.connectionAttemptsPerMinute;
}

function cleanupConnectionWindows() {
  const cutoff = Date.now() - 120_000;
  for (const [ip, window] of connectionWindows) {
    if (window.startedAt < cutoff) connectionWindows.delete(ip);
  }
}

setInterval(cleanupConnectionWindows, 60_000).unref();

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      service: 'orbital-artillery-server',
      rooms: roomStore.size,
      sockets: io?.engine?.clientsCount ?? 0
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

let io;
io = new SocketIOServer(httpServer, {
  cors: {
    origin: CONFIG.clientOrigin,
    methods: ['GET', 'POST']
  },
  allowRequest: (req, callback) => {
    const ip = clientIpFromRequest(req);

    if (io.engine.clientsCount >= CONFIG.maxConcurrentSockets) {
      callback('server_capacity_reached', false);
      return;
    }

    if (!allowConnectionAttempt(ip)) {
      callback('connection_rate_limited', false);
      return;
    }

    callback(null, true);
  }
});

io.on('connection', socket => {
  console.info(`socket connected: ${socket.id}`);

  let packetWindowStartedAt = Date.now();
  let packetCount = 0;
  let lastActivityAt = Date.now();

  socket.use((packet, next) => {
    const now = Date.now();
    lastActivityAt = now;

    if (now - packetWindowStartedAt >= 1_000) {
      packetWindowStartedAt = now;
      packetCount = 0;
    }

    packetCount += 1;
    if (packetCount > CONFIG.packetsPerSecond) {
      console.warn(`socket rate limited: ${socket.id}`);
      socket.disconnect(true);
      return;
    }

    next();
  });

  const idleTimer = setInterval(() => {
    const idleMs = Date.now() - lastActivityAt;
    if (idleMs >= CONFIG.idleSocketMinutes * 60_000) {
      console.info(`socket idle timeout: ${socket.id}`);
      socket.disconnect(true);
    }
  }, 60_000);
  idleTimer.unref();

  socket.on('disconnect', reason => {
    clearInterval(idleTimer);
    console.info(`socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(CONFIG.port, '0.0.0.0', () => {
  console.info(`Orbital Artillery server scaffold listening on :${CONFIG.port}`);
  console.info('Safety limits enabled.', {
    maxRooms: CONFIG.maxRooms,
    maxConcurrentSockets: CONFIG.maxConcurrentSockets,
    connectionAttemptsPerMinute: CONFIG.connectionAttemptsPerMinute,
    packetsPerSecond: CONFIG.packetsPerSecond,
    idleSocketMinutes: CONFIG.idleSocketMinutes
  });
});
