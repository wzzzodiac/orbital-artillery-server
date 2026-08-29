import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { CONFIG } from './config.js';
import {
  activateRoom,
  createRoom,
  findRoomBySocket,
  joinRoom,
  roomStore,
  setGameMode,
  setPlayerReady,
  setPlayerTeam,
  startRoom
} from './rooms.js';
import {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9,
  moveActivePlayer9,
  publicRoomState9,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
} from './phase9.js';
import {
  ensureAfkVoteState,
  registerActiveTurnActivity,
  toggleAfkSkipVote
} from './afk-vote.js';
import { isValidRoomCode, normalizePlayerName } from './validation.js';

const connectionWindows = new Map();
const pendingTransportRemovals = new Map();
const TRANSPORT_RECOVERY_GRACE_MS = 15_000;
const RECOVERABLE_DISCONNECT_REASONS = new Set(['transport close', 'transport error', 'ping timeout']);

function clientIpFromRequest(req) { const forwarded = req.headers['x-forwarded-for']; if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim(); return req.socket.remoteAddress || 'unknown'; }
function allowConnectionAttempt(ip) { const now = Date.now(); const current = connectionWindows.get(ip); if (!current || now - current.startedAt >= 60_000) { connectionWindows.set(ip, { startedAt: now, count: 1 }); return true; } current.count += 1; return current.count <= CONFIG.connectionAttemptsPerMinute; }
function cancelPendingTransportRemoval(socketId) { const timer = pendingTransportRemovals.get(socketId); if (timer) clearTimeout(timer); pendingTransportRemovals.delete(socketId); }
function removeDisconnectedPlayer(socketId, reason = 'expired_transport_disconnect') {
  cancelPendingTransportRemoval(socketId);
  const removal = disconnectPlayer9(socketId);
  if (removal?.room) emitRoomState(removal.room);
  console.info(`player removed after disconnect: ${socketId} (${reason})`);
}
setInterval(() => { const cutoff = Date.now() - 120_000; for (const [ip, window] of connectionWindows) if (window.startedAt < cutoff) connectionWindows.delete(ip); }, 60_000).unref();

let io;
const httpServer = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, service: 'orbital-artillery-server', phase: '9-v0.9-beta', version: '0.9-beta', rooms: roomStore.size, sockets: io?.engine?.clientsCount ?? 0 })); return; }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'not_found' }));
});

io = new SocketIOServer(httpServer, {
  cors: { origin: CONFIG.clientOrigin, methods: ['GET', 'POST'] },
  connectionStateRecovery: { maxDisconnectionDuration: TRANSPORT_RECOVERY_GRACE_MS, skipMiddlewares: true },
  allowRequest: (req, callback) => { const ip = clientIpFromRequest(req); if (io.engine.clientsCount >= CONFIG.maxConcurrentSockets) return callback('server_capacity_reached', false); if (!allowConnectionAttempt(ip)) return callback('connection_rate_limited', false); callback(null, true); }
});
function publicState(room) { ensureAfkVoteState(room); return publicRoomState9(room); }
function emitRoomState(room) { io.to(room.code).emit('room_state', publicState(room)); }

setInterval(() => {
  const now = Date.now();
  for (const room of roomStore.values()) {
    let changed = null;
    if (room.status === 'countdown' && now >= room.match?.startAt) changed = activateRoom(room.code, now);
    else if (room.status === 'started') {
      for (let catchUp = 0; catchUp < 8; catchUp += 1) { const advanced = advanceTurnIfDue9(room.code, now); if (!advanced) break; changed = advanced; }
    }
    if (changed) emitRoomState(changed);
  }
}, 250).unref();

io.on('connection', socket => {
  cancelPendingTransportRemoval(socket.id);
  const recoveredRoom = findRoomBySocket(socket.id);
  if (socket.recovered && recoveredRoom) {
    const recoveredPlayer = recoveredRoom.players.find(player => player.id === socket.id);
    if (recoveredPlayer) recoveredPlayer.connected = true;
    socket.join(recoveredRoom.code);
    emitRoomState(recoveredRoom);
    console.info(`socket recovered: ${socket.id} room=${recoveredRoom.code}`);
  } else console.info(`socket connected: ${socket.id}`);

  let packetWindowStartedAt = Date.now(), packetCount = 0, lastActivityAt = Date.now(), roomActionsStartedAt = Date.now(), roomActionCount = 0;
  socket.use((packet, next) => { const now = Date.now(); lastActivityAt = now; if (now - packetWindowStartedAt >= 1_000) { packetWindowStartedAt = now; packetCount = 0; } packetCount += 1; if (packetCount > CONFIG.packetsPerSecond) { socket.disconnect(true); return; } next(); });
  function allowRoomAction() { const now = Date.now(); if (now - roomActionsStartedAt >= 60_000) { roomActionsStartedAt = now; roomActionCount = 0; } roomActionCount += 1; return roomActionCount <= 20; }
  function replyMutation(result, reply) { if (!result.ok) return reply(result); reply({ ok: true, room: publicState(result.room) }); emitRoomState(result.room); }
  function replyTurnAction(result, reply) {
    if (!result.ok) return reply(result);
    registerActiveTurnActivity(result.room, socket.id);
    reply({ ok: true, room: publicState(result.room) });
    emitRoomState(result.room);
  }

  socket.on('create_room', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); if (findRoomBySocket(socket.id)) return reply({ ok: false, error: 'already_in_room' }); const name = normalizePlayerName(payload?.name); if (!name) return reply({ ok: false, error: 'invalid_name' }); const result = createRoom(socket.id, name); if (!result.ok) return reply(result); result.room.players.find(p => p.id === socket.id).connected = true; socket.join(result.room.code); reply({ ok: true, room: publicState(result.room), playerId: socket.id }); emitRoomState(result.room); });
  socket.on('join_room', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); if (findRoomBySocket(socket.id)) return reply({ ok: false, error: 'already_in_room' }); const name = normalizePlayerName(payload?.name), code = String(payload?.code ?? '').trim().toUpperCase(); if (!name) return reply({ ok: false, error: 'invalid_name' }); if (!isValidRoomCode(code)) return reply({ ok: false, error: 'invalid_room_code' }); const result = joinRoom(code, socket.id, name); if (!result.ok) return reply(result); result.room.players.find(p => p.id === socket.id).connected = true; socket.join(code); reply({ ok: true, room: publicState(result.room), playerId: socket.id }); emitRoomState(result.room); });
  socket.on('set_mode', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setGameMode(socket.id, String(payload?.mode ?? '').toLowerCase()), reply); });
  socket.on('set_terrain', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setTerrain9(socket.id, String(payload?.terrain ?? '').toLowerCase()), reply); });
  socket.on('set_ready', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setPlayerReady(socket.id, payload?.ready), reply); });
  socket.on('set_team', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(setPlayerTeam(socket.id, String(payload?.team ?? '').toUpperCase()), reply); });
  socket.on('start_game', (_payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(startRoom(socket.id), reply); });
  socket.on('rematch_game', (payload, reply = () => {}) => { if (!allowRoomAction()) return reply({ ok: false, error: 'room_action_rate_limited' }); replyMutation(rematchRoom9(socket.id, { randomMap: Boolean(payload?.randomMap) }), reply); });
  socket.on('move_player', (payload, reply = () => {}) => replyTurnAction(moveActivePlayer9(socket.id, payload?.direction), reply));
  socket.on('jump_player', (payload, reply = () => {}) => replyTurnAction(jumpActivePlayer9(socket.id, payload?.direction), reply));
  socket.on('set_aim', (payload, reply = () => {}) => replyTurnAction(setAim9(socket.id, payload?.angle, payload?.power), reply));
  socket.on('select_item', (payload, reply = () => {}) => replyTurnAction(selectItem9(socket.id, payload?.slot), reply));
  socket.on('fire_projectile', (_payload, reply = () => {}) => replyTurnAction(fireProjectile9(socket.id), reply));
  socket.on('toggle_afk_skip_vote', (_payload, reply = () => {}) => {
    const result = toggleAfkSkipVote(socket.id);
    if (!result.ok) return reply(result);
    let room = result.room;
    if (result.skipped) room = advanceTurnIfDue9(room.code, Date.now()) ?? room;
    reply({ ok: true, room: publicState(room), skipped: result.skipped, voted: result.voted });
    emitRoomState(room);
  });

  const idleTimer = setInterval(() => { const room = findRoomBySocket(socket.id); const protectedByActiveMatch = room && (room.status === 'countdown' || room.status === 'started'); if (!protectedByActiveMatch && Date.now() - lastActivityAt >= CONFIG.idleSocketMinutes * 60_000) socket.disconnect(true); }, 60_000);
  idleTimer.unref();
  socket.on('disconnect', reason => {
    clearInterval(idleTimer);
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find(entry => entry.id === socket.id);
    const activeMatch = room && (room.status === 'countdown' || room.status === 'started');
    const recoverableTransportCut = activeMatch && RECOVERABLE_DISCONNECT_REASONS.has(reason);
    if (recoverableTransportCut && player) {
      player.connected = false;
      cancelPendingTransportRemoval(socket.id);
      const timer = setTimeout(() => removeDisconnectedPlayer(socket.id, 'transport_recovery_expired'), TRANSPORT_RECOVERY_GRACE_MS);
      timer.unref?.();
      pendingTransportRemovals.set(socket.id, timer);
      emitRoomState(room);
      console.info(`socket transport interrupted: ${socket.id} (${reason}); recovery grace ${TRANSPORT_RECOVERY_GRACE_MS}ms`);
      return;
    }
    removeDisconnectedPlayer(socket.id, reason);
    console.info(`socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(CONFIG.port, '0.0.0.0', () => console.info(`Orbital Artillery server listening on :${CONFIG.port}`));
