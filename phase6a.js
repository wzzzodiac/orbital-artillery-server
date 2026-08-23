import { randomInt } from 'node:crypto';
import {
  advanceTurnIfDue as baseAdvanceTurnIfDue,
  fireProjectile as baseFireProjectile,
  findRoomBySocket,
  jumpActivePlayer as baseJumpActivePlayer,
  moveActivePlayer as baseMoveActivePlayer,
  publicRoomState as basePublicRoomState
} from './rooms.js';

const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const VEHICLE_GROUND_OFFSET = 8;
const INVENTORY_SIZE = 2;
const PICKUP_EVERY_TURNS = 3;
const PICKUP_LIFETIME_TURNS = 5;
const PICKUP_COLLECT_RADIUS = 64;
const MAX_ACTIVE_PICKUPS = 2;
const HEAVY_MAX_DAMAGE = 60;
const HEAVY_EXPLOSION_RADIUS = 320;
const HEAVY_EXTRA_CRATER_RADIUS = 190;
const HEAVY_EXTRA_CRATER_DEPTH = 90;

const TERRAIN_HOLES = Object.freeze({
  rolling: [],
  terraces: [[2430, 2550]],
  twinpeaks: [[2390, 2510]],
  basin: [[1140, 1240], [3760, 3860]],
  brokenridge: [[1010, 1140], [2410, 2550], [3860, 3980]],
  islands: [[900, 1040], [1920, 2080], [2910, 3070], [3960, 4110]],
  canyon: [[2380, 2580]]
});

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

function terrainSurface(room, x) {
  const px = clamp(x, 0, WORLD_WIDTH), preset = room.terrainPreset || 'rolling';
  if ((TERRAIN_HOLES[preset] ?? []).some(([left, right]) => px >= left && px <= right)) return WORLD_HEIGHT;
  let y = baseTerrainY(preset, px);
  for (const crater of room.arena?.craters ?? []) {
    const dx = Math.abs(px - crater.x);
    if (dx < crater.radius) y += crater.depth * Math.sqrt(Math.max(0, 1 - (dx / crater.radius) ** 2));
  }
  return clamp(y, 120, WORLD_HEIGHT);
}

function ensurePhase6A(room) {
  if (!room) return room;
  if (!Array.isArray(room.pickups)) room.pickups = [];
  if (!Number.isInteger(room.lastPickupSpawnTurn)) room.lastPickupSpawnTurn = 0;
  for (const player of room.players) {
    if (!Array.isArray(player.inventory)) player.inventory = Array(INVENTORY_SIZE).fill(null);
    if (player.inventory.length !== INVENTORY_SIZE) player.inventory = [...player.inventory.slice(0, INVENTORY_SIZE), ...Array(INVENTORY_SIZE).fill(null)].slice(0, INVENTORY_SIZE);
    if (!Number.isInteger(player.selectedItemSlot) || player.selectedItemSlot < 0 || player.selectedItemSlot > INVENTORY_SIZE) player.selectedItemSlot = 0;
  }
  return room;
}

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

function pickupCandidates(room) {
  const result = [];
  for (let x = 420; x <= WORLD_WIDTH - 420; x += 55) {
    const y = terrainSurface(room, x);
    if (y >= WORLD_HEIGHT - 1) continue;
    const left = terrainSurface(room, x - 35), right = terrainSurface(room, x + 35);
    if (left >= WORLD_HEIGHT - 1 || right >= WORLD_HEIGHT - 1) continue;
    if (Math.abs(left - y) > 95 || Math.abs(right - y) > 95) continue;
    if (room.players.some(player => player.spawn && player.alive !== false && Math.hypot(player.spawn.x - x, player.spawn.y - (y - VEHICLE_GROUND_OFFSET)) < 260)) continue;
    if (room.pickups.some(pickup => Math.abs(pickup.x - x) < 260)) continue;
    result.push({ x, y: Math.round(y - 24) });
  }
  return result;
}

function spawnHeavyPickup(room) {
  ensurePhase6A(room);
  if (room.pickups.length >= MAX_ACTIVE_PICKUPS) return false;
  const candidates = pickupCandidates(room);
  if (!candidates.length) return false;
  const point = candidates[randomInt(candidates.length)];
  room.pickups.push({
    id: `${room.code}-pickup-${room.match?.turnNumber ?? 0}-${Date.now()}`,
    type: 'heavy',
    label: 'HEAVY BOMB',
    x: point.x,
    y: point.y,
    spawnTurn: room.match?.turnNumber ?? 0,
    expiresAfterTurn: (room.match?.turnNumber ?? 0) + PICKUP_LIFETIME_TURNS
  });
  room.lastPickupSpawnTurn = room.match?.turnNumber ?? room.lastPickupSpawnTurn;
  return true;
}

function maintainPickups(room) {
  ensurePhase6A(room);
  const turn = room.match?.turnNumber ?? 0;
  room.pickups = room.pickups.filter(pickup => turn <= pickup.expiresAfterTurn);
  if (room.status === 'started' && turn >= PICKUP_EVERY_TURNS && turn % PICKUP_EVERY_TURNS === 0 && room.lastPickupSpawnTurn !== turn) spawnHeavyPickup(room);
}

function collectNearbyPickups(room, player) {
  ensurePhase6A(room);
  if (!player?.spawn || player.alive === false) return false;
  let changed = false;
  for (let index = room.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = room.pickups[index];
    if (Math.hypot(player.spawn.x - pickup.x, (player.spawn.y - 8) - pickup.y) > PICKUP_COLLECT_RADIUS) continue;
    const slot = player.inventory.findIndex(item => item == null);
    if (slot < 0) continue;
    player.inventory[slot] = { type: pickup.type, label: pickup.label, pickedAtTurn: room.match?.turnNumber ?? 0 };
    if (player.selectedItemSlot === 0) player.selectedItemSlot = slot + 1;
    player.lastPickup = { type: pickup.type, label: pickup.label, at: Date.now() };
    room.pickups.splice(index, 1);
    changed = true;
  }
  return changed;
}

function collectForAllPlayers(room) {
  let changed = false;
  for (const player of room.players) changed = collectNearbyPickups(room, player) || changed;
  return changed;
}

function augmentPublicState(room) {
  ensurePhase6A(room);
  const state = basePublicRoomState(room);
  state.phase = '6A';
  state.pickups = room.pickups.map(pickup => ({ ...pickup }));
  state.pickupRules = { everyTurns: PICKUP_EVERY_TURNS, lifetimeTurns: PICKUP_LIFETIME_TURNS, inventorySize: INVENTORY_SIZE };
  state.players = state.players.map(publicPlayer => {
    const player = room.players.find(entry => entry.id === publicPlayer.id);
    return {
      ...publicPlayer,
      inventory: player.inventory.map(item => item ? { ...item } : null),
      selectedItemSlot: player.selectedItemSlot,
      lastPickup: player.lastPickup ? { ...player.lastPickup } : null
    };
  });
  if (state.match?.projectile) state.match.projectile = { ...state.match.projectile };
  return state;
}

export function publicRoomState6A(room) {
  maintainPickups(room);
  return augmentPublicState(room);
}

export function moveActivePlayer6A(socketId, direction) {
  const result = baseMoveActivePlayer(socketId, direction);
  if (!result.ok) return result;
  ensurePhase6A(result.room);
  const player = result.room.players.find(entry => entry.id === socketId);
  collectNearbyPickups(result.room, player);
  return result;
}

export function jumpActivePlayer6A(socketId, direction) {
  const result = baseJumpActivePlayer(socketId, direction);
  if (!result.ok) return result;
  ensurePhase6A(result.room);
  const player = result.room.players.find(entry => entry.id === socketId);
  collectNearbyPickups(result.room, player);
  return result;
}

export function selectItem6A(socketId, rawSlot) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  ensurePhase6A(room);
  const player = room.players.find(entry => entry.id === socketId);
  if (!player || player.alive === false) return { ok: false, error: 'player_missing' };
  const slot = Number(rawSlot);
  if (!Number.isInteger(slot) || slot < 0 || slot > INVENTORY_SIZE) return { ok: false, error: 'invalid_item_slot' };
  if (slot > 0 && !player.inventory[slot - 1]) return { ok: false, error: 'empty_item_slot' };
  player.selectedItemSlot = slot;
  return { ok: true, room };
}

export function fireProjectile6A(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  ensurePhase6A(room);
  const player = room.players.find(entry => entry.id === socketId);
  const selectedSlot = player?.selectedItemSlot ?? 0;
  const item = selectedSlot > 0 ? player?.inventory?.[selectedSlot - 1] : null;
  const result = baseFireProjectile(socketId);
  if (!result.ok) return result;
  const projectile = result.room.match?.projectile;
  if (projectile) projectile.weaponType = item?.type === 'heavy' ? 'heavy' : 'basic';
  if (item?.type === 'heavy') {
    player.inventory[selectedSlot - 1] = null;
    player.selectedItemSlot = 0;
  }
  return result;
}

function applyHeavyEnhancement(room, now) {
  const projectile = room.match?.projectile;
  if (!projectile || projectile.weaponType !== 'heavy' || !projectile.resolutionApplied || projectile.heavyResolutionApplied) return false;
  projectile.heavyResolutionApplied = true;
  if (!['terrain', 'player'].includes(projectile.impactReason)) return true;

  for (const player of room.players) {
    if (!player.spawn) continue;
    const distance = Math.hypot(player.spawn.x - projectile.impactX, (player.spawn.y - 10) - projectile.impactY);
    if (distance > HEAVY_EXPLOSION_RADIUS || player.alive === false) continue;
    let targetDamage = Math.round(HEAVY_MAX_DAMAGE * (1 - distance / HEAVY_EXPLOSION_RADIUS));
    if (projectile.hitPlayerId === player.id) targetDamage = Math.max(targetDamage, HEAVY_MAX_DAMAGE);
    targetDamage = clamp(targetDamage, 1, HEAVY_MAX_DAMAGE);
    const baseDamage = player.lastDamage?.sourcePlayerId === projectile.ownerPlayerId && Math.abs((player.lastDamage?.at ?? 0) - now) < 1500 ? player.lastDamage.amount : 0;
    const bonus = Math.max(0, targetDamage - baseDamage);
    if (!bonus) continue;
    player.hp = Math.max(0, (player.hp ?? 100) - bonus);
    player.lastDamage = { amount: baseDamage + bonus, at: now, sourcePlayerId: projectile.ownerPlayerId };
    if (player.hp <= 0) player.alive = false;
  }

  const ground = terrainSurface(room, projectile.impactX);
  if (ground < WORLD_HEIGHT - 1) room.arena.craters.push({
    id: `${projectile.id}-heavy`,
    x: projectile.impactX,
    radius: HEAVY_EXTRA_CRATER_RADIUS,
    depth: HEAVY_EXTRA_CRATER_DEPTH,
    createdAt: now
  });

  room.match.pendingResult = resultFor(room);
  return true;
}

export function advanceTurnIfDue6A(roomCode, now = Date.now()) {
  const beforeRoom = [...(awaitableRoomStorePlaceholder ?? [])];
  void beforeRoom;
  const result = baseAdvanceTurnIfDue(roomCode, now);
  if (!result) return null;
  ensurePhase6A(result);
  applyHeavyEnhancement(result, now);
  maintainPickups(result);
  collectForAllPlayers(result);
  return result;
}
