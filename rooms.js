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
const MOVE_STEP = 15;
const MOVE_RADIUS = 520;
const MAX_WALK_SURFACE_DELTA = 42;
const JUMP_DISTANCE = 180;
const JUMP_DURATION_MS = 620;
const JUMP_APEX = 150;
const JUMPS_PER_TURN = 2;
const MIN_ANGLE = 5;
const MAX_ANGLE = 85;
const MIN_POWER = 10;
const MAX_POWER = 100;
const DEFAULT_ANGLE = 45;
const DEFAULT_POWER = 55;
const PROJECTILE_GRAVITY = 480;
const PROJECTILE_DT = 0.02;
const PROJECTILE_MAX_SECONDS = 8;
const IMPACT_PAUSE_MS = 900;
const CRATER_RADIUS = 135;
const CRATER_DEPTH = 165;
const FALL_DURATION_MS = 2200;
const VOID_FINISH_BUFFER_MS = 250;
const MAX_HP = 100;
const EXPLOSION_RADIUS = 260;
const EXPLOSION_MAX_DAMAGE = 45;
const VEHICLE_HIT_RADIUS = 26;
const KNOCKBACK_GRAVITY = 520;
const KNOCKBACK_DT = 0.02;
const KNOCKBACK_MAX_SECONDS = 2.4;
const KNOCKBACK_MIN_STRENGTH = 0.10;
const KNOCKBACK_MAX_SPEED = 520;
const KNOCKBACK_LIFT_BIAS = 115;

// EASY TERRAIN RENAMING: change ONLY the text on the right.
const TERRAIN_LABELS = Object.freeze({
  rolling: 'Rolling Expanse',
  terraces: 'Terrace Line',
  twinpeaks: 'Twin Peaks',
  basin: 'Impact Basin',
  brokenridge: 'Broken Ridge',
  islands: 'Drift Islands',
  canyon: 'Canyon Run'
});

const TERRAIN_HOLES = Object.freeze({
  rolling: [],
  terraces: [[2430, 2550]],
  twinpeaks: [[2390, 2510]],
  basin: [[1140, 1240], [3760, 3860]],
  brokenridge: [[1010, 1140], [2410, 2550], [3860, 3980]],
  islands: [[900, 1040], [1920, 2080], [2910, 3070], [3960, 4110]],
  canyon: [[2380, 2580]]
});

const VALID_TERRAINS = new Set(Object.keys(TERRAIN_LABELS));
export const roomStore = new Map();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const gaussian = (x, center, width, amplitude) => amplitude * Math.exp(-((x - center) ** 2) / width);
const plateau = (x, left, right, y, fallback) => (x >= left && x <= right ? y : fallback);

function baseTerrainY(preset, x) {
  switch (preset) {
    case 'terraces': {
      let y = 3520 + Math.sin(x / 560) * 100;
      y = plateau(x, 330, 900, 3190, y); y = plateau(x, 1040, 1640, 2920, y);
      y = plateau(x, 1770, 2350, 3250, y); y = plateau(x, 2630, 3260, 2820, y);
      y = plateau(x, 3390, 3970, 3110, y); y = plateau(x, 4110, 4680, 2870, y);
      return y;
    }
    case 'twinpeaks': {
      let y = 3650 - gaussian(x, 1200, 260000, 850) - gaussian(x, 3820, 300000, 900) + Math.sin(x / 280) * 60;
      if (x > 650 && x < 980) y = 3000; if (x > 1510 && x < 1850) y = 3170;
      if (x > 3150 && x < 3460) y = 3090; if (x > 4050 && x < 4410) y = 2890;
      return y;
    }
    case 'basin': {
      let y = 2870 + gaussian(x, 2500, 850000, 690) + Math.sin(x / 410) * 65;
      if (x > 420 && x < 950) y = 2750; if (x > 1320 && x < 1760) y = 3160;
      if (x > 3240 && x < 3680) y = 3160; if (x > 4050 && x < 4580) y = 2750;
      return y;
    }
    case 'brokenridge': {
      let y = 3490 + Math.sin(x / 210) * 170 + Math.sin(x / 690 + 1.1) * 130;
      if (x > 420 && x < 900) y = 3070; if (x > 1260 && x < 1720) y = 2740;
      if (x > 1900 && x < 2320) y = 3260; if (x > 2700 && x < 3160) y = 2860;
      if (x > 3330 && x < 3770) y = 3180; if (x > 4140 && x < 4620) y = 2780;
      return y;
    }
    case 'islands':
      if (x < 900) return 3100 - gaussian(x, 520, 90000, 260);
      if (x < 1920) return 2840 - gaussian(x, 1470, 125000, 190);
      if (x < 2910) return 3260 - gaussian(x, 2480, 130000, 320);
      if (x < 3960) return 2760 - gaussian(x, 3470, 135000, 220);
      return 3160 - gaussian(x, 4540, 100000, 280);
    case 'canyon': {
      let y = 2920 + Math.min(Math.abs(x - 2500) * 0.28, 700);
      if (x > 420 && x < 980) y = 2700; if (x > 1120 && x < 1640) y = 3030;
      if (x > 1800 && x < 2260) y = 3380; if (x > 2740 && x < 3200) y = 3380;
      if (x > 3360 && x < 3880) y = 3030; if (x > 4020 && x < 4580) y = 2700;
      return y;
    }
    default: {
      let y = 3440 + Math.sin(x / 470) * 165 + Math.sin(x / 980 + 0.7) * 95;
      if (x > 700 && x < 1120) y = 3140; if (x > 1760 && x < 2140) y = 2920;
      if (x > 2840 && x < 3240) y = 3170; if (x > 3890 && x < 4320) y = 2860;
      return y;
    }
  }
}

function insidePresetHole(preset, x) { return (TERRAIN_HOLES[preset] ?? []).some(([left, right]) => x >= left && x <= right); }
function terrainSurface(room, x) {
  const px = clamp(x, 0, WORLD_WIDTH);
  const preset = room.terrainPreset || 'rolling';
  if (insidePresetHole(preset, px)) return WORLD_HEIGHT;
  let y = baseTerrainY(preset, px);
  for (const crater of room.arena?.craters ?? []) {
    const dx = Math.abs(px - crater.x);
    if (dx < crater.radius) y += crater.depth * Math.sqrt(Math.max(0, 1 - (dx / crater.radius) ** 2));
  }
  return clamp(y, 120, WORLD_HEIGHT);
}
function makeSpawn(room, x, facing) {
  const surface = terrainSurface(room, x);
  return { x, y: Math.round(surface >= WORLD_HEIGHT - 1 ? WORLD_HEIGHT + 80 : surface - VEHICLE_GROUND_OFFSET), facing };
}
function evenSpawnPositions(count) {
  if (count <= 0) return [];
  if (count === 1) return [WORLD_WIDTH / 2];
  const left = 360, right = WORLD_WIDTH - 360, step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(left + step * index));
}
function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function previewArena(room) {
  return { id: `preview-${room.terrainPreset}`, terrainPreset: room.terrainPreset, terrainName: TERRAIN_LABELS[room.terrainPreset], craters: [], previewSpawns: evenSpawnPositions(room.players.length), worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT, unitsWide: 5, unitsHigh: 5, viewportUnitsWide: 1, viewportUnitsHigh: 1, seed: room.code, generatedAt: room.createdAt };
}
function publicPlayer(player, hostId) {
  return { id: player.id, name: player.name, ready: player.ready, team: player.team, isHost: player.id === hostId, alive: player.alive !== false, hp: player.hp ?? MAX_HP, maxHp: MAX_HP, spawn: player.spawn ?? null, motion: player.motion ?? null, lastDamage: player.lastDamage ?? null };
}
export function publicRoomState(room) {
  return { code: room.code, status: room.status, mode: room.mode, terrainPreset: room.terrainPreset, terrainPresets: Object.keys(TERRAIN_LABELS).map(id => ({ id, name: TERRAIN_LABELS[id] })), maxPlayers: CONFIG.maxPlayers, arena: room.arena ?? previewArena(room), camera: room.camera ?? null, match: room.match ?? null, players: room.players.map(player => publicPlayer(player, room.hostId)) };
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!roomStore.has(code)) return code;
  }
  throw new Error('room_code_generation_failed');
}
export function getRoom(roomCode) { return roomStore.get(roomCode) ?? null; }
export function canCreateRoom() { return roomStore.size < CONFIG.maxRooms; }
function newPlayer(id, name, team = 'A') { return { id, name, ready: false, team, alive: true, hp: MAX_HP, spawn: null, motion: null, lastDamage: null }; }

export function createRoom(socketId, playerName) {
  if (!canCreateRoom()) return { ok: false, error: 'server_room_capacity' };
  const code = generateRoomCode();
  const room = { code, status: 'lobby', mode: 'team', terrainPreset: 'rolling', hostId: socketId, createdAt: Date.now(), arena: null, match: null, camera: null, players: [newPlayer(socketId, playerName)] };
  roomStore.set(code, room); return { ok: true, room };
}
export function joinRoom(roomCode, socketId, playerName) {
  const room = getRoom(roomCode);
  if (!room) return { ok: false, error: 'room_not_found' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.players.length >= CONFIG.maxPlayers) return { ok: false, error: 'room_full' };
  if (room.players.some(player => player.id === socketId)) return { ok: true, room };
  const teamA = room.players.filter(player => player.team === 'A').length, teamB = room.players.filter(player => player.team === 'B').length;
  room.players.push(newPlayer(socketId, playerName, teamA <= teamB ? 'A' : 'B'));
  return { ok: true, room };
}
export function findRoomBySocket(socketId) { for (const room of roomStore.values()) if (room.players.some(player => player.id === socketId)) return room; return null; }

export function setGameMode(socketId, mode) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' }; if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (!VALID_MODES.has(mode)) return { ok: false, error: 'invalid_mode' }; if (room.mode === mode) return { ok: true, room };
  room.mode = mode; for (const player of room.players) player.ready = false; return { ok: true, room };
}
export function setTerrainPreset(socketId, preset) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' }; if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (!VALID_TERRAINS.has(preset)) return { ok: false, error: 'invalid_terrain' }; if (room.terrainPreset === preset) return { ok: true, room };
  room.terrainPreset = preset; for (const player of room.players) player.ready = false; return { ok: true, room };
}
export function setPlayerReady(socketId, ready) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' }; if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  room.players.find(entry => entry.id === socketId).ready = Boolean(ready); return { ok: true, room };
}
export function setPlayerTeam(socketId, team) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' }; if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.mode !== 'team') return { ok: false, error: 'teams_disabled' }; if (!VALID_TEAMS.has(team)) return { ok: false, error: 'invalid_team' };
  const player = room.players.find(entry => entry.id === socketId); if (player.team === team) return { ok: true, room }; if (room.players.filter(entry => entry.team === team).length >= 4) return { ok: false, error: 'team_full' };
  player.team = team; player.ready = false; return { ok: true, room };
}

function safeSpawnX(room, preferredX) {
  if (terrainSurface(room, preferredX) < WORLD_HEIGHT - 100) return preferredX;
  for (let delta = 30; delta <= 300; delta += 30) for (const sign of [-1, 1]) { const x = clamp(preferredX + delta * sign, 80, WORLD_WIDTH - 80); if (terrainSurface(room, x) < WORLD_HEIGHT - 100) return x; }
  return preferredX;
}
function buildTurnOrder(room) {
  if (room.mode === 'survival') return room.players.map(player => player.id);
  const teamA = room.players.filter(player => player.team === 'A'), teamB = room.players.filter(player => player.team === 'B');
  const first = room.players[0]?.team === 'B' ? teamB : teamA, second = room.players[0]?.team === 'B' ? teamA : teamB, order = [];
  for (let i = 0; i < Math.max(first.length, second.length); i += 1) { if (first[i]) order.push(first[i].id); if (second[i]) order.push(second[i].id); }
  return order;
}
function chooseInitialPlayerId(room, order) {
  if (order.length <= 1) return order[0] ?? null;
  const hostWeight = 0.4 / (order.length - 1);
  const otherWeight = (1 - hostWeight) / (order.length - 1);
  let roll = randomInt(1_000_000) / 1_000_000;
  for (const id of order) {
    const weight = id === room.hostId ? hostWeight : otherWeight;
    if (roll < weight) return id;
    roll -= weight;
  }
  return order[order.length - 1];
}
function rotateOrderTo(order, starterId) {
  const index = order.indexOf(starterId);
  return index <= 0 ? [...order] : [...order.slice(index), ...order.slice(0, index)];
}
function createWind() { const direction = randomInt(2) === 0 ? -1 : 1, strength = randomInt(5, 61); return { direction: direction < 0 ? 'left' : 'right', strength, signed: strength * direction }; }
function activePlayer(room) { return room.players.find(player => player.id === room.match?.activePlayerId) ?? null; }

function resultFor(room) {
  const alive = room.players.filter(player => player.alive !== false);
  if (room.mode === 'survival') {
    if (alive.length > 1) return null;
    return { type: 'survival', winnerPlayerId: alive[0]?.id ?? null, winnerName: alive[0]?.name ?? null, draw: alive.length === 0 };
  }
  const teams = [...new Set(alive.map(player => player.team))];
  if (teams.length > 1) return null;
  return { type: 'team', winnerTeam: teams[0] ?? null, draw: teams.length === 0 };
}
function finishMatch(room, result, now = Date.now()) {
  if (!result || room.status === 'finished') return room;
  room.status = 'finished'; room.match.result = result; room.match.finishedAt = now; room.match.activePlayerId = null; room.match.turnEndsAt = null; room.match.projectile = null; room.camera = { mode: 'follow', targetPlayerId: result.winnerPlayerId ?? room.players.find(player => player.alive !== false)?.id ?? room.players[0]?.id ?? null };
  return room;
}
function beginVoidResolution(room, player, now = Date.now(), motionEndsAt = now + FALL_DURATION_MS) {
  room.match.pendingResult = resultFor(room);
  room.match.turnEndsAt = motionEndsAt + VOID_FINISH_BUFFER_MS;
  room.camera = { mode: 'follow', targetPlayerId: player.id };
  return room;
}

function beginTurn(room, requestedIndex, now = Date.now()) {
  if (room.status === 'finished') return room;
  const liveIds = new Set(room.players.filter(player => player.alive !== false).map(player => player.id));
  room.match.turnOrder = room.match.turnOrder.filter(id => room.players.some(player => player.id === id));
  if (!room.match.turnOrder.length || !liveIds.size) return finishMatch(room, resultFor(room) ?? { type: room.mode, draw: true }, now);
  let orderIndex = ((requestedIndex % room.match.turnOrder.length) + room.match.turnOrder.length) % room.match.turnOrder.length;
  for (let attempt = 0; attempt < room.match.turnOrder.length; attempt += 1) { if (liveIds.has(room.match.turnOrder[orderIndex])) break; orderIndex = (orderIndex + 1) % room.match.turnOrder.length; }
  const activePlayerId = room.match.turnOrder[orderIndex], player = room.players.find(entry => entry.id === activePlayerId);
  if (!player?.spawn) return room;
  for (const entry of room.players) if (entry.alive !== false) entry.motion = null;
  room.match.turnIndex = orderIndex; room.match.turnNumber = (room.match.turnNumber ?? 0) + 1; room.match.activePlayerId = activePlayerId;
  room.match.turnStartedAt = now; room.match.turnEndsAt = now + room.match.turnDurationMs; room.match.wind = createWind(); room.match.movementOriginX = player.spawn.x;
  room.match.movementRadius = MOVE_RADIUS; room.match.jumpsRemaining = JUMPS_PER_TURN; room.match.aimAngle = DEFAULT_ANGLE; room.match.aimPower = DEFAULT_POWER;
  room.match.projectile = null; room.match.shotResolvedAt = null; room.match.pendingResult = null; room.camera = { mode: 'follow', targetPlayerId: activePlayerId }; return room;
}

function assignArena(room) {
  room.arena = { id: `phase5b-${room.terrainPreset}-01`, terrainPreset: room.terrainPreset, terrainName: TERRAIN_LABELS[room.terrainPreset], craters: [], previewSpawns: [], worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT, unitsWide: 5, unitsHigh: 5, viewportUnitsWide: 1, viewportUnitsHigh: 1, seed: room.code, generatedAt: Date.now() };
  for (const player of room.players) { player.alive = true; player.hp = MAX_HP; player.motion = null; player.lastDamage = null; }
  const positions = shuffled(evenSpawnPositions(room.players.length));
  room.players.forEach((player, index) => { const preferred = positions[index], x = safeSpawnX(room, preferred); player.spawn = makeSpawn(room, x, x < WORLD_WIDTH / 2 ? 1 : -1); });
  const now = Date.now();
  const baseOrder = buildTurnOrder(room);
  const initialPlayerId = chooseInitialPlayerId(room, baseOrder);
  const turnOrder = rotateOrderTo(baseOrder, initialPlayerId);
  room.camera = { mode: 'follow', targetPlayerId: turnOrder[0] ?? room.players[0]?.id ?? null };
  room.match = { countdownStartedAt: now, startAt: now + COUNTDOWN_MS, countdownMs: COUNTDOWN_MS, initialPlayerId: turnOrder[0] ?? room.players[0]?.id ?? null, turnDurationMs: TURN_DURATION_MS, turnOrder, turnIndex: -1, turnNumber: 0, activePlayerId: null, turnStartedAt: null, turnEndsAt: null, wind: null, movementOriginX: null, movementRadius: MOVE_RADIUS, jumpsRemaining: JUMPS_PER_TURN, aimAngle: DEFAULT_ANGLE, aimPower: DEFAULT_POWER, projectile: null, shotResolvedAt: null, pendingResult: null, result: null, finishedAt: null };
}
export function startRoom(socketId) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' }; if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' }; if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (room.players.length < 2) return { ok: false, error: 'not_enough_players' }; if (!room.players.every(player => player.ready)) return { ok: false, error: 'players_not_ready' };
  if (room.mode === 'team') { const teamA = room.players.filter(player => player.team === 'A').length, teamB = room.players.filter(player => player.team === 'B').length; if (!teamA || !teamB) return { ok: false, error: 'both_teams_required' }; }
  assignArena(room); room.status = 'countdown'; room.startedAt = Date.now(); return { ok: true, room };
}
export function activateRoom(roomCode, now = Date.now()) { const room = getRoom(roomCode); if (!room || room.status !== 'countdown') return null; room.status = 'started'; room.match.activatedAt = now; return beginTurn(room, 0, now); }

function validateTurnAction(socketId) {
  const room = findRoomBySocket(socketId); if (!room) return { ok: false, error: 'not_in_room' }; if (room.status !== 'started') return { ok: false, error: 'match_not_started' };
  if (room.match?.activePlayerId !== socketId) return { ok: false, error: 'not_your_turn' }; if (room.match?.projectile) return { ok: false, error: 'shot_in_flight' };
  const player = activePlayer(room); if (!player?.spawn || player.alive === false) return { ok: false, error: 'player_missing' }; if (player.motion?.endsAt && Date.now() < player.motion.endsAt) return { ok: false, error: 'player_in_motion' };
  return { ok: true, room, player };
}
function killByVoid(room, player, now = Date.now(), from = player.spawn, toX = player.spawn.x, facing = player.spawn.facing || 1, motionType = 'fall') {
  const targetY = WORLD_HEIGHT + 120, endsAt = now + FALL_DURATION_MS;
  player.hp = 0; player.alive = false; player.spawn = { x: toX, y: targetY, facing };
  player.motion = { type: motionType, startedAt: now, endsAt, fromX: from.x, fromY: from.y, toX, toY: targetY, apex: motionType === 'jump' ? JUMP_APEX : 0 };
  beginVoidResolution(room, player, now, endsAt);
  return true;
}

export function moveActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId); if (!check.ok) return check; const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0; if (!dir) return { ok: false, error: 'invalid_direction' };
  const { room, player } = check, origin = room.match.movementOriginX, minX = Math.max(40, origin - room.match.movementRadius), maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius), from = { ...player.spawn }, nextX = clamp(player.spawn.x + dir * MOVE_STEP, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  const currentSurface = terrainSurface(room, player.spawn.x), nextSurface = terrainSurface(room, nextX);
  if (nextSurface < WORLD_HEIGHT - 1 && currentSurface < WORLD_HEIGHT - 1 && Math.abs(nextSurface - currentSurface) > MAX_WALK_SURFACE_DELTA) return { ok: false, error: 'terrain_too_steep' };
  if (nextSurface >= WORLD_HEIGHT - 1) killByVoid(room, player, Date.now(), from, nextX, dir, 'fall');
  else { player.spawn = makeSpawn(room, nextX, dir); player.motion = null; }
  return { ok: true, room };
}
export function jumpActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId); if (!check.ok) return check; const { room, player } = check; if ((room.match.jumpsRemaining ?? 0) <= 0) return { ok: false, error: 'no_jumps_remaining' };
  const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : (player.spawn.facing || 1), origin = room.match.movementOriginX, minX = Math.max(40, origin - room.match.movementRadius), maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius), from = { ...player.spawn }, nextX = clamp(player.spawn.x + dir * JUMP_DISTANCE, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  const surface = terrainSurface(room, nextX), now = Date.now(); room.match.jumpsRemaining -= 1;
  if (surface >= WORLD_HEIGHT - 1) killByVoid(room, player, now, from, nextX, dir, 'jump');
  else {
    const to = makeSpawn(room, nextX, dir); player.spawn = to; player.motion = { type: 'jump', startedAt: now, endsAt: now + JUMP_DURATION_MS, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, apex: JUMP_APEX };
  }
  return { ok: true, room };
}
export function setAim(socketId, angle, power) { const check = validateTurnAction(socketId); if (!check.ok) return check; const { room } = check; if (angle != null) room.match.aimAngle = clamp(Number(angle) || DEFAULT_ANGLE, MIN_ANGLE, MAX_ANGLE); if (power != null) room.match.aimPower = clamp(Number(power) || DEFAULT_POWER, MIN_POWER, MAX_POWER); return { ok: true, room }; }

function simulateProjectile(room, player, angle, power, now) {
  const facing = player.spawn.facing || 1, radians = angle * Math.PI / 180, speed = 320 + power * 9, startX = player.spawn.x + facing * 24, startY = player.spawn.y - 24, vx = Math.cos(radians) * speed * facing, vy = -Math.sin(radians) * speed, windAccel = (room.match.wind?.signed ?? 0) * 1.5;
  let impactX = startX, impactY = startY, impactT = PROJECTILE_MAX_SECONDS, reason = 'timeout', hitPlayerId = null;
  for (let t = PROJECTILE_DT; t <= PROJECTILE_MAX_SECONDS; t += PROJECTILE_DT) {
    const x = startX + vx * t + 0.5 * windAccel * t * t, y = startY + vy * t + 0.5 * PROJECTILE_GRAVITY * t * t;
    impactX = x; impactY = y; impactT = t;
    if (x < 0 || x > WORLD_WIDTH || y > WORLD_HEIGHT) { reason = 'out_of_bounds'; break; }
    for (const target of room.players) {
      if (target.alive === false || !target.spawn || (target.id === player.id && t < 0.14)) continue;
      if (Math.hypot(x - target.spawn.x, y - (target.spawn.y - 10)) <= VEHICLE_HIT_RADIUS) { reason = 'player'; hitPlayerId = target.id; break; }
    }
    if (hitPlayerId) break;
    const terrain = terrainSurface(room, x); if (terrain < WORLD_HEIGHT && t > 0.08 && y >= terrain) { impactY = terrain; reason = 'terrain'; break; }
  }
  const durationMs = Math.max(220, Math.round(impactT * 1000));
  return { id: `${room.code}-${room.match.turnNumber}-${now}`, ownerPlayerId: player.id, startedAt: now, impactAt: now + durationMs, resolveAt: now + durationMs + IMPACT_PAUSE_MS, durationMs, startX, startY, vx, vy, gravity: PROJECTILE_GRAVITY, windAccel, impactX: clamp(impactX, 0, WORLD_WIDTH), impactY, impactReason: reason, hitPlayerId, angle, power, resolutionApplied: false };
}
export function fireProjectile(socketId, now = Date.now()) { const check = validateTurnAction(socketId); if (!check.ok) return check; const { room, player } = check, projectile = simulateProjectile(room, player, room.match.aimAngle, room.match.aimPower, now); room.match.projectile = projectile; room.match.turnEndsAt = projectile.resolveAt; room.camera = { mode: 'projectile', targetPlayerId: player.id, projectileId: projectile.id }; return { ok: true, room }; }

function applyKnockback(room, player, projectile, distance, now) {
  if (projectile.hitPlayerId === player.id) return null;
  const strength = clamp(1 - distance / EXPLOSION_RADIUS, 0, 1);
  if (strength < KNOCKBACK_MIN_STRENGTH) return null;

  const centerX = player.spawn.x, centerY = player.spawn.y - 10;
  let dx = centerX - projectile.impactX, dy = centerY - projectile.impactY;
  let length = Math.hypot(dx, dy);
  if (length < 1) { dx = player.spawn.facing || 1; dy = -0.25; length = Math.hypot(dx, dy); }
  const nx = dx / length, ny = dy / length;
  const speed = (150 + (KNOCKBACK_MAX_SPEED - 150) * strength);
  const vx = nx * speed;
  const vy = ny * speed - KNOCKBACK_LIFT_BIAS * strength;
  const from = { ...player.spawn };
  let finalX = from.x, finalY = from.y, duration = 0.25, voided = false;

  for (let t = KNOCKBACK_DT; t <= KNOCKBACK_MAX_SECONDS; t += KNOCKBACK_DT) {
    const x = clamp(from.x + vx * t, 20, WORLD_WIDTH - 20);
    const y = from.y + vy * t + 0.5 * KNOCKBACK_GRAVITY * t * t;
    const verticalVelocity = vy + KNOCKBACK_GRAVITY * t;
    const surface = terrainSurface(room, x);
    finalX = x; finalY = y; duration = t;

    if (surface >= WORLD_HEIGHT - 1) {
      if (y >= WORLD_HEIGHT + 120) { finalY = WORLD_HEIGHT + 120; voided = true; break; }
      continue;
    }

    const groundY = surface - VEHICLE_GROUND_OFFSET;
    if (t > 0.08 && verticalVelocity >= 0 && y >= groundY) {
      finalY = Math.round(groundY);
      break;
    }
  }

  if (!voided) {
    const surface = terrainSurface(room, finalX);
    if (surface >= WORLD_HEIGHT - 1) {
      voided = true;
      finalY = WORLD_HEIGHT + 120;
      duration = Math.max(duration, 1.15);
    } else {
      finalY = Math.round(surface - VEHICLE_GROUND_OFFSET);
    }
  }

  const endsAt = now + Math.max(260, Math.round(duration * 1000));
  player.spawn = { x: Math.round(finalX), y: finalY, facing: vx < -1 ? -1 : vx > 1 ? 1 : (player.spawn.facing || 1) };
  player.motion = {
    type: voided ? 'knockbackVoid' : 'knockback',
    startedAt: now,
    endsAt,
    fromX: from.x,
    fromY: from.y,
    toX: player.spawn.x,
    toY: player.spawn.y,
    vx,
    vy,
    gravity: KNOCKBACK_GRAVITY,
    strength
  };

  if (voided) { player.hp = 0; player.alive = false; }
  return { endsAt, voided, strength };
}

function applyImpactResolution(room, projectile, now) {
  if (!projectile || projectile.resolutionApplied || !['terrain', 'player'].includes(projectile.impactReason)) return false;
  projectile.resolutionApplied = true;
  const affected = [];

  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const distance = Math.hypot(player.spawn.x - projectile.impactX, (player.spawn.y - 10) - projectile.impactY);
    if (distance > EXPLOSION_RADIUS) continue;
    let damage = Math.round(EXPLOSION_MAX_DAMAGE * (1 - distance / EXPLOSION_RADIUS));
    if (projectile.hitPlayerId === player.id) damage = Math.max(damage, EXPLOSION_MAX_DAMAGE);
    damage = clamp(damage, 1, EXPLOSION_MAX_DAMAGE); player.hp = Math.max(0, (player.hp ?? MAX_HP) - damage); player.lastDamage = { amount: damage, at: now, sourcePlayerId: projectile.ownerPlayerId };
    affected.push({ player, distance });
    if (player.hp <= 0) player.alive = false;
  }

  const groundY = terrainSurface(room, projectile.impactX);
  if (groundY < WORLD_HEIGHT - 1) room.arena.craters.push({ id: projectile.id, x: projectile.impactX, radius: CRATER_RADIUS, depth: CRATER_DEPTH, createdAt: projectile.impactAt });

  let latestMotionEnd = 0;
  for (const { player, distance } of affected) {
    if (player.alive === false || !player.spawn) continue;
    const knockback = applyKnockback(room, player, projectile, distance, now);
    if (knockback) latestMotionEnd = Math.max(latestMotionEnd, knockback.endsAt);
  }

  for (const player of room.players) {
    if (player.alive === false || !player.spawn || ['knockback', 'knockbackVoid'].includes(player.motion?.type)) continue;
    const surface = terrainSurface(room, player.spawn.x), targetY = surface >= WORLD_HEIGHT - 1 ? WORLD_HEIGHT + 120 : surface - VEHICLE_GROUND_OFFSET;
    if (targetY <= player.spawn.y + 2) continue;
    const from = { ...player.spawn };
    if (surface >= WORLD_HEIGHT - 1) {
      killByVoid(room, player, now, from, player.spawn.x, player.spawn.facing || 1, 'fall');
      latestMotionEnd = Math.max(latestMotionEnd, player.motion.endsAt);
    } else {
      player.spawn = { ...player.spawn, y: Math.round(targetY) };
      player.motion = { type: 'fall', startedAt: now, endsAt: now + Math.min(FALL_DURATION_MS, 900), fromX: from.x, fromY: from.y, toX: player.spawn.x, toY: player.spawn.y, apex: 0 };
      latestMotionEnd = Math.max(latestMotionEnd, player.motion.endsAt);
    }
  }

  room.match.pendingResult = resultFor(room);
  if (latestMotionEnd) {
    projectile.resolveAt = Math.max(projectile.resolveAt, latestMotionEnd + VOID_FINISH_BUFFER_MS);
    room.match.turnEndsAt = projectile.resolveAt;
  }
  return true;
}

export function advanceTurnIfDue(roomCode, now = Date.now()) {
  const room = getRoom(roomCode); if (!room || room.status !== 'started' || !room.match?.turnEndsAt) return null;
  const projectile = room.match.projectile;
  if (projectile && now >= projectile.impactAt && !projectile.resolutionApplied) { const changed = applyImpactResolution(room, projectile, now); if (changed && now < projectile.resolveAt) return room; }
  if (projectile && now < projectile.resolveAt) return null;
  if (!projectile && now < room.match.turnEndsAt) return null;
  if (projectile) room.match.shotResolvedAt = now;
  if (room.match.pendingResult) return finishMatch(room, room.match.pendingResult, now);
  room.match.projectile = null;
  return beginTurn(room, room.match.turnIndex + 1, now);
}

export function removePlayer(socketId) {
  const room = findRoomBySocket(socketId); if (!room) return null;
  const previousTurnIndex = room.match?.turnIndex ?? -1, previousOrder = room.match?.turnOrder ? [...room.match.turnOrder] : [], removedOrderIndex = previousOrder.indexOf(socketId), wasActive = room.match?.activePlayerId === socketId;
  room.players = room.players.filter(player => player.id !== socketId);
  if (!room.players.length) { roomStore.delete(room.code); return { deleted: true, roomCode: room.code, room: null }; }
  if (room.hostId === socketId) room.hostId = room.players[0].id;
  if (room.status === 'lobby') for (const player of room.players) player.ready = false;
  else if (room.match?.turnOrder) {
    room.match.turnOrder = room.match.turnOrder.filter(id => id !== socketId);
    const result = resultFor(room); if (result) finishMatch(room, result);
    else if (wasActive) { const nextIndex = room.match.turnOrder.length ? Math.max(previousTurnIndex, 0) % room.match.turnOrder.length : 0; beginTurn(room, nextIndex, Date.now()); }
    else if (removedOrderIndex >= 0 && removedOrderIndex < previousTurnIndex) room.match.turnIndex = Math.max(0, previousTurnIndex - 1);
  }
  if (room.camera?.targetPlayerId === socketId) room.camera.targetPlayerId = room.match?.activePlayerId ?? room.players.find(player => player.alive !== false)?.id ?? room.players[0].id;
  return { deleted: false, roomCode: room.code, room };
}
