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
const MOVE_RADIUS = 260;
const JUMP_DISTANCE = 90;
const JUMP_DURATION_MS = 520;
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

const TERRAIN_PRESETS = Object.freeze({
  rolling: { name: 'Rolling Expanse', holes: [] },
  terraces: { name: 'Terrace Line', holes: [] },
  twinpeaks: { name: 'Twin Peaks', holes: [] },
  basin: { name: 'Impact Basin', holes: [] },
  brokenridge: { name: 'Broken Ridge', holes: [[2360, 2580]] },
  islands: { name: 'Drift Islands', holes: [[2250, 2460], [2920, 3100], [4550, 4740]] },
  canyon: { name: 'Canyon Run', holes: [[2410, 2590]] }
});
const VALID_TERRAINS = new Set(Object.keys(TERRAIN_PRESETS));

export const roomStore = new Map();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function baseTerrainY(preset, x) {
  switch (preset) {
    case 'terraces': {
      const raw = 3260 + Math.sin(x / 520) * 360 + Math.sin(x / 155) * 55;
      return Math.round(raw / 130) * 130;
    }
    case 'twinpeaks':
      return 3550 - 720 * Math.exp(-((x - 1450) ** 2) / 420000) - 780 * Math.exp(-((x - 3550) ** 2) / 460000) + Math.sin(x / 330) * 75;
    case 'basin':
      return 2980 + 520 * Math.exp(-((x - 2500) ** 2) / 900000) + Math.sin(x / 410) * 95;
    case 'brokenridge':
      return 3350 + Math.sin(x / 240) * 250 + Math.sin(x / 720 + 1.1) * 170;
    case 'islands':
      return 3250 + Math.sin(x / 300) * 220 + Math.sin(x / 890) * 125;
    case 'canyon':
      return 3160 + Math.abs(x - 2500) * 0.18 + Math.sin(x / 360) * 110;
    default:
      return 3370 + Math.sin(x / 430) * 180 + Math.sin(x / 970 + 0.7) * 130;
  }
}

function insidePresetHole(preset, x) {
  return TERRAIN_PRESETS[preset]?.holes?.some(([left, right]) => x >= left && x <= right) ?? false;
}

function terrainSurface(room, x) {
  const px = clamp(x, 0, WORLD_WIDTH);
  const preset = room.terrainPreset || 'rolling';
  if (insidePresetHole(preset, px)) return WORLD_HEIGHT;
  let y = baseTerrainY(preset, px);
  for (const crater of room.arena?.craters ?? []) {
    const dx = Math.abs(px - crater.x);
    if (dx >= crater.radius) continue;
    const shape = Math.sqrt(Math.max(0, 1 - (dx / crater.radius) ** 2));
    y += crater.depth * shape;
  }
  return clamp(y, 120, WORLD_HEIGHT);
}

function makeSpawn(room, x, facing) {
  const surface = terrainSurface(room, x);
  return { x, y: Math.round(surface >= WORLD_HEIGHT - 1 ? WORLD_HEIGHT + 80 : surface - VEHICLE_GROUND_OFFSET), facing };
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!roomStore.has(code)) return code;
  }
  throw new Error('room_code_generation_failed');
}

function publicPlayer(player, hostId) {
  return { id: player.id, name: player.name, ready: player.ready, team: player.team, isHost: player.id === hostId, alive: player.alive !== false, spawn: player.spawn ?? null, motion: player.motion ?? null };
}

export function publicRoomState(room) {
  return { code: room.code, status: room.status, mode: room.mode, terrainPreset: room.terrainPreset, terrainPresets: Object.entries(TERRAIN_PRESETS).map(([id, value]) => ({ id, name: value.name })), maxPlayers: CONFIG.maxPlayers, arena: room.arena ?? null, match: room.match ?? null, camera: room.camera ?? null, players: room.players.map(player => publicPlayer(player, room.hostId)) };
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
  player.team = team; player.ready = false; return { ok: true, room };
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
  const eligible = room.match.turnOrder.filter(id => liveIds.has(id));
  if (!eligible.length) { room.match.activePlayerId = null; room.match.turnEndsAt = null; return room; }
  let orderIndex = ((requestedIndex % room.match.turnOrder.length) + room.match.turnOrder.length) % room.match.turnOrder.length;
  for (let attempt = 0; attempt < room.match.turnOrder.length; attempt += 1) {
    const candidate = room.match.turnOrder[orderIndex];
    if (liveIds.has(candidate)) break;
    orderIndex = (orderIndex + 1) % room.match.turnOrder.length;
  }
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

function safeSpawnX(room, preferredX) {
  if (terrainSurface(room, preferredX) < WORLD_HEIGHT - 100) return preferredX;
  for (let delta = 40; delta <= 420; delta += 40) {
    for (const sign of [-1, 1]) {
      const x = clamp(preferredX + delta * sign, 80, WORLD_WIDTH - 80);
      if (terrainSurface(room, x) < WORLD_HEIGHT - 100) return x;
    }
  }
  return preferredX;
}

function assignArena(room) {
  room.arena = { id: `phase5a-${room.terrainPreset}-01`, terrainPreset: room.terrainPreset, terrainName: TERRAIN_PRESETS[room.terrainPreset].name, craters: [], worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, viewportWidth: VIEWPORT_WIDTH, viewportHeight: VIEWPORT_HEIGHT, unitsWide: 5, unitsHigh: 5, viewportUnitsWide: 1, viewportUnitsHigh: 1, seed: room.code, generatedAt: Date.now() };
  for (const player of room.players) { player.alive = true; player.motion = null; }
  if (room.mode === 'survival') {
    const slots = [620, 1140, 1680, 2220, 2780, 3320, 3860, 4380];
    room.players.forEach((player, index) => { const x = safeSpawnX(room, slots[index]); player.spawn = makeSpawn(room, x, x < WORLD_WIDTH / 2 ? 1 : -1); });
  } else {
    const teamA = room.players.filter(player => player.team === 'A');
    const teamB = room.players.filter(player => player.team === 'B');
    const left = [620, 1050, 1480, 1910]; const right = [4380, 3950, 3520, 3090];
    teamA.forEach((player, index) => { const x = safeSpawnX(room, left[index]); player.spawn = makeSpawn(room, x, 1); });
    teamB.forEach((player, index) => { const x = safeSpawnX(room, right[index]); player.spawn = makeSpawn(room, x, -1); });
  }
  const now = Date.now(); const turnOrder = buildTurnOrder(room);
  room.camera = { mode: 'follow', targetPlayerId: turnOrder[0] ?? room.players[0].id };
  room.match = { countdownStartedAt: now, startAt: now + COUNTDOWN_MS, countdownMs: COUNTDOWN_MS, initialPlayerId: turnOrder[0] ?? room.players[0].id, turnDurationMs: TURN_DURATION_MS, turnOrder, turnIndex: -1, turnNumber: 0, activePlayerId: null, turnStartedAt: null, turnEndsAt: null, wind: null, movementOriginX: null, movementRadius: MOVE_RADIUS, jumpsRemaining: JUMPS_PER_TURN, aimAngle: DEFAULT_ANGLE, aimPower: DEFAULT_POWER, projectile: null, shotResolvedAt: null };
}

export function startRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (room.players.length < 2) return { ok: false, error: 'not_enough_players' };
  if (!room.players.every(player => player.ready)) return { ok: false, error: 'players_not_ready' };
  if (room.mode === 'team' && (!room.players.some(player => player.team === 'A') || !room.players.some(player => player.team === 'B'))) return { ok: false, error: 'both_teams_required' };
  assignArena(room); room.status = 'countdown'; room.startedAt = Date.now(); return { ok: true, room };
}

export function activateRoom(roomCode, now = Date.now()) { const room = getRoom(roomCode); if (!room || room.status !== 'countdown') return null; room.status = 'started'; room.match.activatedAt = now; return beginTurn(room, 0, now); }

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

function landOrFall(room, player, nextX, facing, now = Date.now(), motionType = 'move') {
  const from = { ...player.spawn };
  const surface = terrainSurface(room, nextX);
  if (surface >= WORLD_HEIGHT - 1) {
    player.alive = false;
    player.spawn = { x: nextX, y: WORLD_HEIGHT + 180, facing };
    player.motion = { type: 'fall', startedAt: now, endsAt: now + FALL_DURATION_MS, fromX: from.x, fromY: from.y, toX: nextX, toY: WORLD_HEIGHT + 180, apex: 0 };
    room.match.turnEndsAt = Math.min(room.match.turnEndsAt ?? now + 800, now + FALL_DURATION_MS + 180);
    return;
  }
  player.spawn = makeSpawn(room, nextX, facing);
  if (motionType === 'jump') player.motion = { type: 'jump', startedAt: now, endsAt: now + JUMP_DURATION_MS, fromX: from.x, fromY: from.y, toX: player.spawn.x, toY: player.spawn.y, apex: 95 };
  else player.motion = null;
}

export function moveActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId); if (!check.ok) return check;
  const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0; if (!dir) return { ok: false, error: 'invalid_direction' };
  const { room, player } = check; const origin = room.match.movementOriginX; const minX = Math.max(40, origin - room.match.movementRadius); const maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius); const nextX = clamp(player.spawn.x + dir * MOVE_STEP, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  landOrFall(room, player, nextX, dir); return { ok: true, room };
}

export function jumpActivePlayer(socketId, direction) {
  const check = validateTurnAction(socketId); if (!check.ok) return check;
  const { room, player } = check; if ((room.match.jumpsRemaining ?? 0) <= 0) return { ok: false, error: 'no_jumps_remaining' };
  const dir = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : (player.spawn.facing || 1); const origin = room.match.movementOriginX; const minX = Math.max(40, origin - room.match.movementRadius); const maxX = Math.min(WORLD_WIDTH - 40, origin + room.match.movementRadius); const nextX = clamp(player.spawn.x + dir * JUMP_DISTANCE, minX, maxX);
  if (Math.abs(nextX - player.spawn.x) < 0.01) return { ok: false, error: 'movement_limit' };
  landOrFall(room, player, nextX, dir, Date.now(), 'jump'); room.match.jumpsRemaining -= 1; return { ok: true, room };
}

export function setAim(socketId, angle, power) { const check = validateTurnAction(socketId); if (!check.ok) return check; const { room } = check; if (angle != null) room.match.aimAngle = clamp(Number(angle) || DEFAULT_ANGLE, MIN_ANGLE, MAX_ANGLE); if (power != null) room.match.aimPower = clamp(Number(power) || DEFAULT_POWER, MIN_POWER, MAX_POWER); return { ok: true, room }; }

function simulateProjectile(room, player, angle, power, now) {
  const facing = player.spawn.facing || 1; const radians = angle * Math.PI / 180; const speed = 320 + power * 9; const startX = player.spawn.x + facing * 24; const startY = player.spawn.y - 24; const vx = Math.cos(radians) * speed * facing; const vy = -Math.sin(radians) * speed; const windAccel = (room.match.wind?.signed ?? 0) * 1.5;
  let impactX = startX, impactY = startY, impactT = PROJECTILE_MAX_SECONDS, reason = 'timeout';
  for (let t = PROJECTILE_DT; t <= PROJECTILE_MAX_SECONDS; t += PROJECTILE_DT) {
    const x = startX + vx * t + 0.5 * windAccel * t * t; const y = startY + vy * t + 0.5 * PROJECTILE_GRAVITY * t * t; impactX = x; impactY = y; impactT = t;
    if (x < 0 || x > WORLD_WIDTH || y > WORLD_HEIGHT) { reason = 'out_of_bounds'; break; }
    const surface = terrainSurface(room, x);
    if (surface < WORLD_HEIGHT && t > 0.08 && y >= surface) { impactY = surface; reason = 'terrain'; break; }
  }
  const durationMs = Math.max(220, Math.round(impactT * 1000));
  return { id: `${room.code}-${room.match.turnNumber}-${now}`, ownerPlayerId: player.id, startedAt: now, impactAt: now + durationMs, resolveAt: now + durationMs + IMPACT_PAUSE_MS, durationMs, startX, startY, vx, vy, gravity: PROJECTILE_GRAVITY, windAccel, impactX: clamp(impactX, 0, WORLD_WIDTH), impactY, impactReason: reason, angle, power };
}

export function fireProjectile(socketId, now = Date.now()) { const check = validateTurnAction(socketId); if (!check.ok) return check; const { room, player } = check; const projectile = simulateProjectile(room, player, room.match.aimAngle, room.match.aimPower, now); room.match.projectile = projectile; room.match.turnEndsAt = projectile.resolveAt; room.camera = { mode: 'projectile', targetPlayerId: player.id, projectileId: projectile.id }; return { ok: true, room }; }

function settlePlayersAfterCrater(room, now) {
  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const surface = terrainSurface(room, player.spawn.x);
    if (surface >= WORLD_HEIGHT - 1) {
      const from = { ...player.spawn };
      player.alive = false;
      player.spawn = { ...from, y: WORLD_HEIGHT + 180 };
      player.motion = { type: 'fall', startedAt: now, endsAt: now + FALL_DURATION_MS, fromX: from.x, fromY: from.y, toX: from.x, toY: WORLD_HEIGHT + 180, apex: 0 };
      continue;
    }
    const targetY = Math.round(surface - VEHICLE_GROUND_OFFSET);
    if (targetY > player.spawn.y + 2) {
      const from = { ...player.spawn };
      const distance = targetY - from.y;
      const duration = clamp(220 + distance * 1.2, 260, 900);
      player.spawn = { ...player.spawn, y: targetY };
      player.motion = { type: 'fall', startedAt: now, endsAt: now + duration, fromX: from.x, fromY: from.y, toX: from.x, toY: targetY, apex: 0 };
    }
  }
}

function resolveProjectileTerrain(room, projectile, now) {
  if (projectile.impactReason !== 'terrain') return;
  room.arena.craters.push({ id: `${projectile.id}-crater`, x: projectile.impactX, y: projectile.impactY, radius: CRATER_RADIUS, depth: CRATER_DEPTH, createdAt: now });
  if (room.arena.craters.length > 80) room.arena.craters.splice(0, room.arena.craters.length - 80);
  settlePlayersAfterCrater(room, now);
}

export function advanceTurnIfDue(roomCode, now = Date.now()) {
  const room = getRoom(roomCode); if (!room || room.status !== 'started' || !room.match?.turnEndsAt) return null;
  const projectile = room.match.projectile;
  if (projectile && now < projectile.resolveAt) return null;
  if (!projectile && now < room.match.turnEndsAt) return null;
  if (projectile) { resolveProjectileTerrain(room, projectile, now); room.match.shotResolvedAt = now; }
  room.match.projectile = null;
  return beginTurn(room, (room.match.turnIndex ?? 0) + 1, now);
}

export function removePlayer(socketId) {
  const room = findRoomBySocket(socketId); if (!room) return null;
  const previousTurnIndex = room.match?.turnIndex ?? -1; const previousOrder = room.match?.turnOrder ? [...room.match.turnOrder] : []; const removedOrderIndex = previousOrder.indexOf(socketId); const wasActive = room.match?.activePlayerId === socketId;
  room.players = room.players.filter(player => player.id !== socketId);
  if (!room.players.length) { roomStore.delete(room.code); return { deleted: true, roomCode: room.code, room: null }; }
  if (room.hostId === socketId) room.hostId = room.players[0].id;
  if (room.status === 'lobby') for (const player of room.players) player.ready = false;
  else if (room.match?.turnOrder) {
    room.match.turnOrder = room.match.turnOrder.filter(id => id !== socketId);
    if (wasActive) beginTurn(room, Math.min(Math.max(previousTurnIndex, 0), Math.max(0, room.match.turnOrder.length - 1)), Date.now());
    else if (removedOrderIndex >= 0 && removedOrderIndex < previousTurnIndex) room.match.turnIndex = Math.max(0, previousTurnIndex - 1);
  }
  if (room.camera?.targetPlayerId === socketId) room.camera.targetPlayerId = room.match?.activePlayerId ?? room.players[0].id;
  return { deleted: false, roomCode: room.code, room };
}
