import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { CONFIG } from './config.js';
import {
  activateRoom,
  createRoom,
  findRoomBySocket,
  joinRoom,
  removePlayer,
  roomStore,
  setAim,
  setGameMode,
  setPlayerReady,
  setPlayerTeam,
  setTerrainPreset,
  startRoom
} from './rooms.js';
import {
  advanceTurnIfDue6A,
  fireProjectile6A,
  jumpActivePlayer6A,
  moveActivePlayer6A,
  publicRoomState6A,
  selectItem6A
} from './phase6a.js';
import { isValidRoomCode, normalizePlayerName } from './validation.js';

const connectionWindows = new Map();
function clientIpFromRequest(req) { const forwarded = req.headers['x-forwarded-for']; if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim(); return req.socket.remoteAddress || 'unknown'; }
function allowConnectionAttempt(ip) { const now = Date.now(); const current = connectionWindows.get(ip); if (!current || now - current.startedAt >= 60_000) { connectionWindows.set(ip, { startedAt: now, count: 1 }); return true; } current.count += 1; return current.count <= CONFIG.connectionAttemptsPerMinute; }
setInterval(() => { const cutoff = Date.now() - 120_000; for (const [ip, window] of connectionWindows) if (window.startedAt < cutoff) connectionWindows.delete(ip); }, 60_000).unref();

let io;
const httpServer = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, service: 'orbital-artillery-server', phase: '6A', rooms: roomStore.size, sockets: io?.engine?.clientsCount ?? 0 })); return; }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'not_found' }));
});

io = new SocketIOServer(httpServer, { cors: { origin: CONFIG.clientOrigin, methods: ['GET', 'POST'] }, allowRequest: (req, callback) => { const ip = clientIpFromRequest(req); if (io.engine.clientsCount >= CONFIG.maxConcurrentSockets) return callback('server_capacity_reached', false); if (!allowConnectionAttempt(ip)) return callback('connection_rate_limited', false); callback(null, true); } });
function emitRoomState(room) { io.to(room.code).emit('room_state', publicRoomState6A(room)); }

setInterval(() => {
  const now = Date.now();
  for (const room of roomStore.values()) {
    let changed = null;
    if (room.status === 'countdown' && now >= room.match?.startAt) changed = activateRoom(room.code, now);
    else if (room.status === 'started') {
      for (let catchUp = 0; catchUp < 8; catchUp += 1) { const advanced = advanceTurnIfDue6A(room.code, now); if (!advanced) break; changed = advanced; }
    }
    if (changed) emitRoomState(changed);
  }
}, 250).unref();

io.on('connection', socket => {
  console.info(`socket connected: ${socket.id}`);
  let packetWindowStartedAt = Date.now(), packetCount = 0, lastActivityAt = Date.now(), roomActionsStartedAt = Date.now(), roomActionCount = 0;
  socket.use((packet, next) => { const now = Date.now(); lastActivityAt = now; if (now - packetWindowStartedAt >= 1_000) { packetWindowStartedAt = now; packetCount = 0; } packetCount += 1; if (packetCount > CONFIG.packetsPerSecond) { socket.disconnect(true); return; } next(); });
  function allowRoomAction() { const now = Date.now(); if (now - roomActionsStartedAt >= 60_000) { roomActionsStartedAt = now; roomActionCount = 0; } roomActionCount += 1; return roomActionCount <= 20; }
  function replyMutation(result, reply) { if (!result.ok) return reply(result); reply({ ok: true, room: publicRoomState6A(result.room) }); emitRoomState(result.room); }

  socket.on('create_room', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); if (findRoomBySocket(socket.id)) return reply({ ok: false, error: 'already_in_room' }); const name = normalizePlayerName(payload?.name); if (!name) return reply({ ok: false, error: 'invalid_name' }); const result = createRoom(socket.id, name); if (!result.ok) return reply(result); socket.join(result.room.code); reply({ ok: true, room: publicRoomState6A(result.room), playerId: socket.id }); emitRoomState(result.room); });
  socket.on('join_room', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); if (findRoomBySocket(socket.id)) return reply({ ok: false, error: 'already_in_room' }); const name = normalizePlayerName(payload?.name), code = String(payload?.code ?? '').trim().toUpperCase(); if (!name) return reply({ ok: false, error: 'invalid_name' }); if (!isValidRoomCode(code)) return reply({ ok: false, error: 'invalid_room_code' }); const result = joinRoom(code, socket.id, name); if (!result.ok) return reply(result); socket.join(code); reply({ ok: true, room: publicRoomState6A(result.room), playerId: socket.id }); emitRoomState(result.room); });
  socket.on('set_mode', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setGameMode(socket.id, String(payload?.mode ?? '').toLowerCase()), reply); });
  socket.on('set_terrain', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setTerrainPreset(socket.id, String(payload?.terrain ?? '').toLowerCase()), reply); });
  socket.on('set_ready', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setPlayerReady(socket.id, payload?.ready), reply); });
  socket.on('set_team', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setPlayerTeam(socket.id, String(payload?.team ?? '').toUpperCase()), reply); });
  socket.on('start_game', (_payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(startRoom(socket.id), reply); });
  socket.on('move_player', (payload, reply = () => {}) => replyMutation(moveActivePlayer6A(socket.id, payload?.direction), reply));
  socket.on('jump_player', (payload, reply = () => {}) => replyMutation(jumpActivePlayer6A(socket.id, payload?.direction), reply));
  socket.on('set_aim', (payload, reply = () => {}) => replyMutation(setAim(socket.id, payload?.angle, payload?.power), reply));
  socket.on('select_item', (payload, reply = () => {}) => replyMutation(selectItem6A(socket.id, payload?.slot), reply));
  socket.on('fire_projectile', (_payload, reply = () => {}) => replyMutation(fireProjectile6A(socket.id), reply));

  const idleTimer = setInterval(() => { const room = findRoomBySocket(socket.id); const protectedByActiveMatch = room && (room.status === 'countdown' || room.status === 'started'); if (!protectedByActiveMatch && Date.now() - lastActivityAt >= CONFIG.idleSocketMinutes * 60_000) socket.disconnect(true); }, 60_000);
  idleTimer.unref();
  socket.on('disconnect', reason => { clearInterval(idleTimer); const removal = removePlayer(socket.id); if (removal?.room) emitRoomState(removal.room); console.info(`socket disconnected: ${socket.id} (${reason})`); });
});

httpServer.listen(CONFIG.port, '0.0.0.0', () => console.info(`Orbital Artillery server listening on :${CONFIG.port}`));
