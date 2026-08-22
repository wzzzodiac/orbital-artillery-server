import { randomInt } from 'node:crypto';
import { CONFIG } from './config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_TEAMS = new Set(['A', 'B']);
const VALID_MODES = new Set(['team', 'survival']);
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 1000;
const COUNTDOWN_MS = 7000;
const TURN_DURATION_MS = 40000;
const VEHICLE_GROUND_OFFSET = 8;

export const roomStore = new Map();

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!roomStore.has(code)) return code;
  }
  throw new Error('room_code_generation_failed');
}

function publicPlayer(player, hostId) {
  return { id: player.id, name: player.name, ready: player.ready, team: player.team, isHost: player.id === hostId, spawn: player.spawn ?? null };
}

export function publicRoomState(room) {
  return { code: room.code, status: room.status, mode: room.mode, maxPlayers: CONFIG.maxPlayers, arena: room.arena ?? null, match: room.match ?? null, camera: room.camera ?? null, players: room.players.map(player => publicPlayer(player, room.hostId)) };
}
export function getRoom(roomCode) { return roomStore.get(roomCode) ?? null; }
export function canCreateRoom() { return roomStore.size < CONFIG.maxRooms; }

export function createRoom(socketId, playerName) {
  if (!canCreateRoom()) return { ok: false, error: 'server_room_capacity' };
  const code = generateRoomCode();
  const room = { code, status: 'lobby', mode: 'team', hostId: socketId, createdAt: Date.now(), arena: null, match: null, camera: null, players: [{ id: socketId, name: playerName, ready: false, team: 'A', spawn: null }] };
  roomStore.set(code, room);
  return { ok: true, room };
}

export function joinRoom(roomCode, socketId, playerName) {
  const room = getRoom(roomCode);
  if (!room) return { ok: false, error: 'room_not_found' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.players.length >= CONFIG.maxPlayers) return { ok: false, error: 'room_full' };
  if (room.players.some(player => player.id === socketId)) return { ok: true, room };
  const teamA = room.players.filter(player => player.team === 'A').length;
  const teamB = room.players.filter(player => player.team === 'B').length;
  room.players.push({ id: socketId, name: playerName, ready: false, team: teamA <= teamB ? 'A' : 'B', spawn: null });
  return { ok: true, room };
}

export function findRoomBySocket(socketId) {
  for (const room of roomStore.values()) if (room.players.some(player => player.id === socketId)) return room;
  return null;
}

export function setGameMode(socketId, mode) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (!VALID_MODES.has(mode)) return { ok: false, error: 'invalid_mode' };
  if (room.mode === mode) return { ok: true, room };
  room.mode = mode;
  for (const player of room.players) player.ready = false;
  return { ok: true, room };
}

export function setPlayerReady(socketId, ready) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  room.players.find(entry => entry.id === socketId).ready = Boolean(ready);
  return { ok: true, room };
}

export function setPlayerTeam(socketId, team) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.mode !== 'team') return { ok: false, error: 'teams_disabled' };
  if (!VALID_TEAMS.has(team)) return { ok: false, error: 'invalid_team' };
  const player = room.players.find(entry => entry.id === socketId);
  if (player.team === team) return { ok: true, room };
  if (room.players.filter(entry => entry.team === team).length >= 4) return { ok: false, error: 'team_full' };
  player.team = team;
  player.ready = false;
  return { ok: true, room };
}

function terrainY(x) { return 3370 + Math.sin(x / 430) * 180 + Math.sin(x / 970 + 0.7) * 130; }
function makeSpawn(x, facing) { return { x, y: Math.round(terrainY(x) - VEHICLE_GROUND_OFFSET), facing }; }

function buildTurnOrder(room) {
  if (room.mode === 'survival') return room.players.map(player => player.id);
  const teamA = room.players.filter(player => player.team === 'A');
  const teamB = room.players.filter(player => player.team === 'B');
  const firstTeam = room.players[0]?.team === 'B' ? 'B' : 'A';
  const first = firstTeam === 'A' ? teamA : teamB;
  const second = firstTeam === 'A' ? teamB : teamA;
  const order = [];
  const rounds = Math.max(first.length, second.length);
  for (let index = 0; index < rounds; index += 1) {
    if (first[index]) order.push(first[index].id);
    if (second[index]) order.push(second[index].id);
  }
  return order;
}

function createWind() {
  const direction = randomInt(2) === 0 ? -1 : 1;
  const strength = randomInt(5, 61);
  return { direction: direction < 0 ? 'left' : 'right', strength, signed: strength * direction };
}

function beginTurn(room, requestedIndex, now = Date.now()) {
  const liveIds = new Set(room.players.map(player => player.id));
  room.match.turnOrder = room.match.turnOrder.filter(id => liveIds.has(id));
  if (room.match.turnOrder.length === 0) return null;
  const index = ((requestedIndex % room.match.turnOrder.length) + room.match.turnOrder.length) % room.match.turnOrder.length;
  const activePlayerId = room.match.turnOrder[index];
  room.match.turnIndex = index;
  room.match.turnNumber = (room.match.turnNumber ?? 0) + 1;
  room.match.activePlayerId = activePlayerId;
  room.match.turnStartedAt = now;
  room.match.turnEndsAt = now + room.match.turnDurationMs;
  room.match.wind = createWind();
  room.camera = { mode: 'follow', targetPlayerId: activePlayerId };
  return room;
}

function assignArena(room) {
  if (room.mode === 'survival') {
    const slots = [620, 1140, 1680, 2220, 2780, 3320, 3860, 4380];
    room.players.forEach((player, index) => { const x = slots[index]; player.spawn = makeSpawn(x, x < WORLD_WIDTH / 2 ? 1 : -1); });
  } else {
    const teamA = room.players.filter(player => player.team === 'A');
    const teamB = room.players.filter(player => player.team === 'B');
    const left = [620, 1050, 1480, 1910];
    const right = [4380, 3950, 3520, 3090];
    teamA.forEach((player, index) => { player.spawn = makeSpawn(left[index], 1); });
    teamB.forEach((player, index) => { player.spawn = makeSpawn(right[index], -1); });
  }
  const now = Date.now();
  const turnOrder = buildTurnOrder(room);
  room.arena = { id: 'phase3-expanse-01', worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT, unitsWide: 5, unitsHigh: 5, viewportUnitsWide: 1, viewportUnitsHigh: 1, seed: room.code, generatedAt: now };
  room.camera = { mode: 'follow', targetPlayerId: turnOrder[0] ?? room.players[0].id };
  room.match = { countdownStartedAt: now, startAt: now + COUNTDOWN_MS, countdownMs: COUNTDOWN_MS, initialPlayerId: turnOrder[0] ?? room.players[0].id, turnDurationMs: TURN_DURATION_MS, turnOrder, turnIndex: -1, turnNumber: 0, activePlayerId: null, turnStartedAt: null, turnEndsAt: null, wind: null };
}

export function startRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (room.players.length < 2) return { ok: false, error: 'not_enough_players' };
  if (!room.players.every(player => player.ready)) return { ok: false, error: 'players_not_ready' };
  if (room.mode === 'team') {
    const teamA = room.players.filter(player => player.team === 'A').length;
    const teamB = room.players.filter(player => player.team === 'B').length;
    if (teamA === 0 || teamB === 0) return { ok: false, error: 'both_teams_required' };
  }
  assignArena(room);
  room.status = 'countdown';
  room.startedAt = Date.now();
  return { ok: true, room };
}

export function activateRoom(roomCode, now = Date.now()) {
  const room = getRoom(roomCode);
  if (!room || room.status !== 'countdown') return null;
  room.status = 'started';
  room.match.activatedAt = now;
  return beginTurn(room, 0, now);
}

export function advanceTurnIfDue(roomCode, now = Date.now()) {
  const room = getRoom(roomCode);
  if (!room || room.status !== 'started' || !room.match?.turnEndsAt) return null;
  if (now < room.match.turnEndsAt) return null;
  return beginTurn(room, room.match.turnIndex + 1, now);
}

export function removePlayer(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;
  const previousTurnIndex = room.match?.turnIndex ?? -1;
  const previousOrder = room.match?.turnOrder ? [...room.match.turnOrder] : [];
  const removedOrderIndex = previousOrder.indexOf(socketId);
  const wasActive = room.match?.activePlayerId === socketId;
  room.players = room.players.filter(player => player.id !== socketId);
  if (room.players.length === 0) { roomStore.delete(room.code); return { deleted: true, roomCode: room.code, room: null }; }
  if (room.hostId === socketId) room.hostId = room.players[0].id;
  if (room.status === 'lobby') {
    for (const player of room.players) player.ready = false;
  } else if (room.match?.turnOrder) {
    room.match.turnOrder = room.match.turnOrder.filter(id => id !== socketId);
    if (wasActive) {
      const nextIndex = Math.min(Math.max(previousTurnIndex, 0), room.match.turnOrder.length - 1);
      beginTurn(room, nextIndex, Date.now());
    } else if (removedOrderIndex >= 0 && removedOrderIndex < previousTurnIndex) {
      room.match.turnIndex = Math.max(0, previousTurnIndex - 1);
    }
  }
  if (room.camera?.targetPlayerId === socketId) room.camera.targetPlayerId = room.match?.activePlayerId ?? room.players[0].id;
  return { deleted: false, roomCode: room.code, room };
}
