import { randomInt } from 'node:crypto';
import { findRoomBySocket } from './rooms.js';
import {
  advanceTurnIfDue6A as baseAdvance,
  fireProjectile6A as baseFire,
  jumpActivePlayer6A as baseJump,
  moveActivePlayer6A as baseMove,
  publicRoomState6A as basePublic,
  selectItem6A as baseSelect
} from './phase6a.js';

const HEAL_AMOUNT = 30;
const MAX_HP = 100;
const HEAL_WEIGHT = 15;
const BASE_POOL_WEIGHT = 100;
const FULL_POOL_WEIGHT = BASE_POOL_WEIGHT + HEAL_WEIGHT;

const ITEM_POOL = [
  { type: 'heavy', label: 'HEAVY BOMB', weight: 30 },
  { type: 'triple', label: 'TRIPLE SHOT', weight: 30 },
  { type: 'cluster', label: 'CLUSTER BOMB', weight: 25 },
  { type: 'shield', label: 'SHIELD', weight: 15 },
  { type: 'heal', label: 'HEAL +30', weight: HEAL_WEIGHT }
];

function rollHealForNewPickup(room) {
  if (!room?.match || !Array.isArray(room.pickups)) return false;
  const turn = room.match.turnNumber ?? 0;
  let changed = false;
  for (const box of room.pickups) {
    if (box.spawnTurn !== turn || box.phase6cPoolRolled) continue;
    box.phase6cPoolRolled = true;
    if (randomInt(FULL_POOL_WEIGHT) < HEAL_WEIGHT) {
      box.type = 'heal';
      box.label = 'HEAL +30';
      changed = true;
    }
  }
  return changed;
}

function publicState(room) {
  let state = basePublic(room);
  if (rollHealForNewPickup(room)) state = basePublic(room);
  state.phase = '6C.1';
  state.itemPool = ITEM_POOL.map(item => ({ ...item }));
  state.healRules = { amount: HEAL_AMOUNT, maxHp: MAX_HP, instant: true, consumesTurn: false, blockedAtFullHp: true };
  state.players = state.players.map(publicPlayer => {
    const player = room.players.find(entry => entry.id === publicPlayer.id);
    return { ...publicPlayer, lastUtility: player?.lastUtility ? { ...player.lastUtility } : null };
  });
  return state;
}

function healValidationError(room, player, socketId) {
  if (!room) return 'not_in_room';
  if (room.status !== 'started') return 'match_not_started';
  if (room.match?.activePlayerId !== socketId) return 'not_your_turn';
  if (room.match?.projectile) return 'shot_in_flight';
  if (!player?.spawn || player.alive === false) return 'player_missing';
  if (player.motion?.endsAt && Date.now() < player.motion.endsAt) return 'player_in_motion';
  return null;
}

export function fireProjectile6A(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  const player = room.players.find(entry => entry.id === socketId);
  const slot = player?.selectedItemSlot ?? 1;
  const item = slot > 1 ? player?.inventory?.[slot - 2] : null;
  if (item?.type !== 'heal') return baseFire(socketId);

  const blocked = healValidationError(room, player, socketId);
  if (blocked) return { ok: false, error: blocked };
  if ((player.hp ?? MAX_HP) >= MAX_HP) return { ok: false, error: 'heal_full_hp' };

  const before = player.hp ?? MAX_HP;
  const after = Math.min(MAX_HP, before + HEAL_AMOUNT);
  const healed = after - before;
  player.hp = after;
  player.inventory[slot - 2] = null;
  player.selectedItemSlot = 1;
  player.lastUtility = { type: 'heal', label: `HEAL +${healed} HP`, amount: healed, at: Date.now() };
  return { ok: true, room, healed };
}

export function publicRoomState6A(room) { return publicState(room); }
export function advanceTurnIfDue6A(code, now = Date.now()) { return baseAdvance(code, now); }
export function moveActivePlayer6A(socketId, direction) { return baseMove(socketId, direction); }
export function jumpActivePlayer6A(socketId, direction) { return baseJump(socketId, direction); }
export function selectItem6A(socketId, slot) { return baseSelect(socketId, slot); }
