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
const IMPACT_PAUSE_MS = 650;
const CRATER_RADIUS = 135;
const CRATER_DEPTH = 165;
const FALL_DURATION_MS = 760;

// ================================================================
// EASY TERRAIN RENAMING
// Change ONLY the text on the right side. The IDs on the left are
// internal and must stay unchanged. Renaming these labels will NOT
// break physics, saved room state, or the client selector.
// ================================================================
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
      y = plateau(x, 330, 900, 3190, y);
      y = plateau(x, 1040, 1640, 2920, y);
      y = plateau(x, 1770, 2350, 3250, y);
      y = plateau(x, 2630, 3260, 2820, y);
      y = plateau(x, 3390, 3970, 3110, y);
      y = plateau(x, 4110, 4680, 2870, y);
      return y;
    }
    case 'twinpeaks': {
      let y = 3650 - gaussian(x, 1200, 260000, 850) - gaussian(x, 3820, 300000, 900);
      y += Math.sin(x / 280) * 60;
      if (x > 650 && x < 980) y = 3000;
      if (x > 1510 && x < 1850) y = 3170;
      if (x > 3150 && x < 3460) y = 3090;
      if (x > 4050 && x < 4410) y = 2890;
      return y;
    }
    case 'basin': {
      let y = 2870 + gaussian(x, 2500, 850000, 690) + Math.sin(x / 410) * 65;
      if (x > 420 && x < 950) y = 2750;
      if (x > 1320 && x < 1760) y = 3160;
      if (x > 3240 && x < 3680) y = 3160;
      if (x > 4050 && x < 4580) y = 2750;
      return y;
    }
    case 'brokenridge': {
      let y = 3490 + Math.sin(x / 210) * 170 + Math.sin(x / 690 + 1.1) * 130;
      if (x > 420 && x < 900) y = 3070;
      if (x > 1260 && x < 1720) y = 2740;
      if (x > 1900 && x < 2320) y = 3260;
      if (x > 2700 && x < 3160) y = 2860;
      if (x > 3330 && x < 3770) y = 3180;
      if (x > 4140 && x < 4620) y = 2780;
      return y;
    }
    case 'islands': {
      if (x < 900) return 3100 - gaussian(x, 520, 90000, 260);
      if (x < 1920) return 2840 - gaussian(x, 1470, 125000, 190);
      if (x < 2910) return 3260 - gaussian(x, 2480, 130000, 320);
      if (x < 3960) return 2760 - gaussian(x, 3470, 135000, 220);
      return 3160 - gaussian(x, 4540, 100000, 280);
    }
    case 'canyon': {
      let y = 2920 + Math.min(Math.abs(x - 2500) * 0.28, 700);
      if (x > 420 && x < 980) y = 2700;
      if (x > 1120 && x < 1640) y = 3030;
      if (x > 1800 && x < 2260) y = 3380;
      if (x > 2740 && x < 3200) y = 3380;
      if (x > 3360 && x < 3880) y = 3030;
      if (x > 4020 && x < 4580) y = 2700;
      return y;
    }
    default: {
      let y = 3440 + Math.sin(x / 470) * 165 + Math.sin(x / 980 + 0.7) * 95;
      if (x > 700 && x < 1120) y = 3140;
      if (x > 1760 && x < 2140) y = 2920;
      if (x > 2840 && x < 3240) y = 3170;
      if (x > 3890 && x < 4320) y = 2860;
      return y;
    }
  }
}

function insidePresetHole(preset, x) {
  return (TERRAIN_HOLES[preset] ?? []).some(([left, right]) => x >= left && x <= right);
}

function terrainSurface(room, x) {
  const px = clamp(x, 0, WORLD_WIDTH);
  const preset = room.terrainPreset || 'rolling';
  if (insidePresetHole(preset, px)) return WORLD_HEIGHT;
  let y = baseTerrainY(preset, px);
  for (const crater of room.arena?.craters ?? []) {
    const dx = Math.abs(px - crater.x);
    if (dx >= crater.radius) continue;
    y += crater.depth * Math.sqrt(Math.max(0, 1 - (dx / crater.radius) ** 2));
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
  const left = 360;
  const right = WORLD_WIDTH - 360;
  const step = (right - left) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(left + step * index));
}

function previewArena(room) {
  return {
    id: `preview-${room.terrainPreset}`,
    terrainPreset: room.terrainPreset,
    terrainName: TERRAIN_LABELS[room.terrainPreset],
    craters: [],
    previewSpawns: evenSpawnPositions(room.players.length),
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    unitsWide: 5,
    unitsHigh: 5,
    viewportUnitsWide: 1,
    viewportUnitsHigh: 1,
    seed: room.code,
    generatedAt: room.createdAt
  };
}

function publicPlayer(player, hostId) {
  return { id: player.id, name: player.name, ready: player.ready, team: player.team, isHost: player.id === hostId, alive: player.alive !== false, spawn: player.spawn ?? null, motion: player.motion ?? null };
}

export function publicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    terrainPreset: room.terrainPreset,
    terrainPresets: Object.keys(TERRAIN_LABELS).map(id => ({ id, name: TERRAIN_LABELS[id] })),
    maxPlayers: CONFIG.maxPlayers,
    arena: room.arena ?? previewArena(room),
    camera: room.camera ?? null,
    match: room.match ?? null,
    players: room.players.map(player => publicPlayer(player, room.hostId))
  };
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

export function createRoom(socketId, playerName) {
  if (!canCreateRoom()) return { ok: false, error: 'server_room_capacity' };
  const code = generateRoomCode();
  const room = { code, status: 'lobby', mode: 'team', terrainPreset: 'rolling', hostId: socketId, createdAt: Date.now(), arena: null, match: null, camera: null, players: [{ id: socketId, name: playerName, ready: false, team: 'A', alive: true, spawn: null, motion: null }] };
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
  room.players.push({ id: socketId, name: playerName, ready: false, team: teamA <= teamB ? 'A' : 'B', alive: true, spawn: null, motion: null });
  return { ok: true, room };
}

export function findRoomBySocket(socketId) { for (const room of roomStore.values()) if (room.players.some(player => player.id === socketId)) return room; return null; }

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

export function setTerrainPreset(socketId, preset) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (!VALID_TERRAINS.has(preset)) return { ok: false, error: 'invalid_terrain' };
  if (room.terrainPreset === preset) return { ok: true, room };
  room.terrainPreset = preset;
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

function safeSpawnX(room, preferredX) {
  if (terrainSurface(room, preferredX) < WORLD_HEIGHT - 100) return preferredX;
  for (let delta = 30; delta <= 300; delta += 30) {
    for (const sign of [-1, 1]) {
      const x = clamp(preferredX + delta * sign, 80, WORLD_WIDTH - 80);
      if (terrainSurface(room, x) < WORLD_HEIGHT - 100) return x;
    }
  }
  return preferredX;
}

function buildTurnOrder(room) {
  if (room.mode === 'survival') return room.players.map(player => player.id);
  const teamA = room.players.filter(player => player.team === 'A');
  const teamB = room.players.filter(player => player.team === 'B');
  const firstTeam = room.players[0]?.team === 'B' ? 'B' : 'A';
  const first = firstTeam === 'A' ? teamA : teamB;
  const second = firstTeam === 'A' ? teamB : teamA;
  const order = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) { if (first[index]) order.push(first[index].id); if (second[index]) order.push(second[index].id); }
  return order;
}

function createWind() { const direction = randomInt(2) === 0 ? -1 : 1; const strength = randomInt(5, 61); return { direction: direction < 0 ? 'left' : 'right', strength, signed: strength * direction }; }
function activePlayer(room) { return room.players.find(player => player.id === room.match?.activePlayerId) ?? null; }

function beginTurn(room, requestedIndex, now = Date.now()) {
  const liveIds = new Set(room.players.filter(player => player.alive !== false).map(player => player.id));
  room.match.turnOrder = room.match.turnOrder.filter(id => room.players.some(player => player.id === id));
  if (!room.match.turnOrder.length || !liveIds.size) { room.match.activePlayerId = null; room.match.turnEndsAt = null; return room; }
  let orderIndex = ((requestedIndex % room.match.turnOrder.length) + room.match.turnOrder.length) % room.match.turnOrder.length;
  for (let attempt = 0; attempt < room.match.turnOrder.length; attempt += 1) { if (liveIds.has(room.match.turnOrder[orderIndex])) break; orderIndex = (orderIndex + 1) % room.match.turnOrder.length; }
  const activePlayerId = room.match.turnOrder[orderIndex];
  const player = room.players.find(entry => entry.id === activePlayerId);
  if (!player?.spawn) return room;
  for (const entry of room.players) if (entry.alive !== false) entry.motion = null;
  room.match.turnIndex = orderIndex;
  room.match.turnNumber = (room.match.turnNumber ?? 0) + 1;
  room.match.activePlayerId = activePlayerId;
  room.match.turnStartedAt = now;
  room.match.turnEndsAt = now + room.match.turnDurationMs;
  room.match.wind = createWind();
  room.match.movementOriginX = player.spawn.x;
  room.match.movementRadius = MOVE_RADIUS;
  room.match.jumpsRemaining = JUMPS_PER_TURN;
  room.match.aimAngle = DEFAULT_ANGLE;
  room.match.aimPower = DEFAULT_POWER;
  room.match.projectile = null;
  room.match.shotResolvedAt = null;
  room.camera = { mode: 'follow', targetPlayerId: activePlayerId };
  return room;
}

function assignArena(room) {
  room.arena = { id: `phase5a-${room.terrainPreset}-02`, terrainPreset: room.terrainPreset, terrainName: TERRAIN_LABELS[room.terrainPreset], craters: [], previewSpawns: [], worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT, unitsWide: 5, unitsHigh: 5, viewportUnitsWide: 1, viewportUnitsHigh: 1, seed: room.code, generatedAt: Date.now() };
  for (const player of room.players) { player.alive = true; player.motion = null; }
  const positions = evenSpawnPositions(room.players.length);
  room.players.forEach((player, index) => { const preferred = positions[index]; const x = safeSpawnX(room, preferred); player.spawn = makeSpawn(room, x, x < WORLD_WIDTH / 2 ? 1 : -1); });
  const now = Date.now();
  const turnOrder = buildTurnOrder(room);
  room.camera = { mode: 'follow', targetPlayerId: turnOrder[0] ?? room.players[0]?.id ?? null };
  room.match = { countdownStartedAt: now, startAt: now + COUNTDOWN_MS, countdownMs: COUNTDOWN_MS, initialPlayerId: turnOrder[0] ?? room.players[0]?.id ?? null, turnDurationMs: TURN_DURATION_MS, turnOrder, turnIndex: -1, turnNumber: 0, activePlayerId: null, turnStartedAt: null, turnEndsAt: null, wind: null, movementOriginX: null, movementRadius: MOVE_RADIUS, jumpsRemaining: JUMPS_PER_TURN, aimAngle: DEFAULT_ANGLE, aimPower: DEFAULT_POWER, projectile: null, shotResolvedAt: null };
}

export function startRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (room.players.length < 2) return { ok: false, error: 'not_enough_players' };
  if (!room.players.every(player => player.ready)) return { ok: false, error: 'players_not_ready' };
  if (room.mode === 'team') { const teamA = room.players.filter(player => player.team === 'A').length; const teamB = room.players.filter(player => player.team === 'B').length; if (teamA === 0 || teamB === 0) return { ok: false, error: 'both_teams_required' }; }
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

function validateTurnAction(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'started') return { ok: false, error: 'match_not_started' };
  if (room.match?.activePlayerId !== socketId) return { ok: false, error: 'not_your_turn' };
  if (room.match?.projectile) return { ok: false, error: 'shot_in_flight' };
  const player = activePlayer(room);
  if (!player?.spawn || player.alive === false) return { ok: false, error: 'player_missing' };
  if (player.motion?.endsAt && Date.now() < player.motion.endsAt) return { ok: false, error: 'player_in_motion' };
  return { ok: true, room, player };
}

function markOutIfVoid(room, player, now = Date.now()) {
  const surface = terrainSurface(room, player.spawn.x);
  if (surface < WORLD_HEIGHT - 1) return false;
  const from = { ...player.spawn };
  player.spawn = { ...player.spawn, y: WORLD_HEIGHT + 120 };
  player.motion = { type: 'fall', startedAt: now, endsAt: now + FALL_DURATION_MS, fromX: from.x, fromY: from.y, toX: from.x, toY: WORLD_HEIGHT + 120, apex: 0 };
  player.alive = false;
  return true;
}

export function moveActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId);
  if (!check.ok) return check;
  const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
  if (!dir) return { ok: false, error: 'invalid_direction' };
  const { room, player } = check;
  const origin = room.match.movementOriginX;
  const minX = Math.max(40, origin - room.match.movementRadius);
  const maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius);
  const nextX = clamp(player.spawn.x + dir * MOVE_STEP, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  const currentSurface = terrainSurface(room, player.spawn.x);
  const nextSurface = terrainSurface(room, nextX);
  if (nextSurface < WORLD_HEIGHT - 1 && currentSurface < WORLD_HEIGHT - 1 && Math.abs(nextSurface - currentSurface) > MAX_WALK_SURFACE_DELTA) return { ok: false, error: 'terrain_too_steep' };
  player.spawn = makeSpawn(room, nextX, dir);
  player.motion = null;
  markOutIfVoid(room, player);
  return { ok: true, room };
}

export function jumpActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId);
  if (!check.ok) return check;
  const { room, player } = check;
  if ((room.match.jumpsRemaining ?? 0) <= 0) return { ok: false, error: 'no_jumps_remaining' };
  const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : (player.spawn.facing || 1);
  const origin = room.match.movementOriginX;
  const minX = Math.max(40, origin - room.match.movementRadius);
  const maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius);
  const from = { ...player.spawn };
  const nextX = clamp(player.spawn.x + dir * JUMP_DISTANCE, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  const to = makeSpawn(room, nextX, dir);
  const now = Date.now();
  player.spawn = to;
  player.motion = { type: 'jump', startedAt: now, endsAt: now + JUMP_DURATION_MS, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, apex: JUMP_APEX };
  room.match.jumpsRemaining -= 1;
  if (to.y > WORLD_HEIGHT) { player.alive = false; player.spawn = { ...to, y: WORLD_HEIGHT + 120 }; player.motion.toY = WORLD_HEIGHT + 120; }
  return { ok: true, room };
}

export function setAim(socketId, angle, power) {
  const check = validateTurnAction(socketId);
  if (!check.ok) return check;
  const { room } = check;
  if (angle != null) room.match.aimAngle = clamp(Number(angle) || DEFAULT_ANGLE, MIN_ANGLE, MAX_ANGLE);
  if (power != null) room.match.aimPower = clamp(Number(power) || DEFAULT_POWER, MIN_POWER, MAX_POWER);
  return { ok: true, room };
}

function simulateProjectile(room, player, angle, power, now) {
  const facing = player.spawn.facing || 1;
  const radians = angle * Math.PI / 180;
  const speed = 320 + power * 9;
  const startX = player.spawn.x + facing * 24;
  const startY = player.spawn.y - 24;
  const vx = Math.cos(radians) * speed * facing;
  const vy = -Math.sin(radians) * speed;
  const windAccel = (room.match.wind?.signed ?? 0) * 1.5;
  let impactX = startX, impactY = startY, impactT = PROJECTILE_MAX_SECONDS, reason = 'timeout';
  for (let t = PROJECTILE_DT; t <= PROJECTILE_MAX_SECONDS; t += PROJECTILE_DT) {
    const x = startX + vx * t + 0.5 * windAccel * t * t;
    const y = startY + vy * t + 0.5 * PROJECTILE_GRAVITY * t * t;
    impactX = x; impactY = y; impactT = t;
    if (x < 0 || x > WORLD_WIDTH || y > WORLD_HEIGHT) { reason = 'out_of_bounds'; break; }
    const surface = terrainSurface(room, x);
    if (surface < WORLD_HEIGHT && t > 0.08 && y >= surface) { impactY = surface; reason = 'terrain'; break; }
  }
  const durationMs = Math.max(220, Math.round(impactT * 1000));
  return { id: `${room.code}-${room.match.turnNumber}-${now}`, ownerPlayerId: player.id, startedAt: now, impactAt: now + durationMs, resolveAt: now + durationMs + IMPACT_PAUSE_MS, durationMs, startX, startY, vx, vy, gravity: PROJECTILE_GRAVITY, windAccel, impactX: clamp(impactX, 0, WORLD_WIDTH), impactY, impactReason: reason, angle, power, craterApplied: false };
}

export function fireProjectile(socketId, now = Date.now()) {
  const check = validateTurnAction(socketId);
  if (!check.ok) return check;
  const { room, player } = check;
  const projectile = simulateProjectile(room, player, room.match.aimAngle, room.match.aimPower, now);
  room.match.projectile = projectile;
  room.match.turnEndsAt = projectile.resolveAt;
  room.camera = { mode: 'projectile', targetPlayerId: player.id, projectileId: projectile.id };
  return { ok: true, room };
}

function applyCraterAndGravity(room, projectile, now) {
  if (!projectile || projectile.craterApplied || projectile.impactReason !== 'terrain') return;
  room.arena.craters.push({ id: projectile.id, x: projectile.impactX, radius: CRATER_RADIUS, depth: CRATER_DEPTH, createdAt: projectile.impactAt });
  projectile.craterApplied = true;
  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const surface = terrainSurface(room, player.spawn.x);
    const targetY = surface >= WORLD_HEIGHT - 1 ? WORLD_HEIGHT + 120 : surface - VEHICLE_GROUND_OFFSET;
    if (targetY <= player.spawn.y + 2) continue;
    const from = { ...player.spawn };
    player.spawn = { ...player.spawn, y: Math.round(targetY) };
    player.motion = { type: 'fall', startedAt: now, endsAt: now + FALL_DURATION_MS, fromX: from.x, fromY: from.y, toX: player.spawn.x, toY: player.spawn.y, apex: 0 };
    if (surface >= WORLD_HEIGHT - 1) player.alive = false;
  }
}

export function advanceTurnIfDue(roomCode, now = Date.now()) {
  const room = getRoom(roomCode);
  if (!room || room.status !== 'started' || !room.match?.turnEndsAt) return null;
  const projectile = room.match.projectile;
  if (projectile && now >= projectile.impactAt && !projectile.craterApplied) applyCraterAndGravity(room, projectile, now);
  if (projectile && now < projectile.resolveAt) return projectile.craterApplied ? room : null;
  if (!projectile && now < room.match.turnEndsAt) return null;
  if (projectile) room.match.shotResolvedAt = now;
  room.match.projectile = null;
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
  if (room.status === 'lobby') { for (const player of room.players) player.ready = false; }
  else if (room.match?.turnOrder) {
    room.match.turnOrder = room.match.turnOrder.filter(id => id !== socketId);
    if (wasActive) { const nextIndex = Math.min(Math.max(previousTurnIndex, 0), Math.max(room.match.turnOrder.length - 1, 0)); beginTurn(room, nextIndex, Date.now()); }
    else if (removedOrderIndex >= 0 && removedOrderIndex < previousTurnIndex) room.match.turnIndex = Math.max(0, previousTurnIndex - 1);
  }
  if (room.camera?.targetPlayerId === socketId) room.camera.targetPlayerId = room.match?.activePlayerId ?? room.players[0].id;
  return { deleted: false, roomCode: room.code, room };
}
