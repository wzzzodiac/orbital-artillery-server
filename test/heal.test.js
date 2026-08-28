import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateRoom,
  createRoom,
  joinRoom,
  roomStore,
  setGameMode,
  setPlayerReady,
  startRoom
} from '../rooms.js';
import { fireProjectile6A, publicRoomState6A } from '../phase6c.js';

function makeStartedRoom(ids = ['a', 'b']) {
  roomStore.clear();
  const [host, ...others] = ids;
  const room = createRoom(host, host.toUpperCase()).room;
  for (const id of others) assert.equal(joinRoom(room.code, id, id.toUpperCase()).ok, true);
  assert.equal(setGameMode(host, 'survival').ok, true);
  for (const id of ids) assert.equal(setPlayerReady(id, true).ok, true);
  assert.equal(startRoom(host).ok, true);
  activateRoom(room.code, room.match.startAt);
  return room;
}

function equipHeal(room, playerId, hp) {
  const player = room.players.find(entry => entry.id === playerId);
  room.match.activePlayerId = playerId;
  room.match.projectile = null;
  player.hp = hp;
  player.alive = true;
  player.motion = null;
  player.inventory = [{ type: 'heal', label: 'HEAL +30', pickedAtTurn: room.match.turnNumber }, null];
  player.selectedItemSlot = 2;
  return player;
}

test('Heal restores up to 30 HP, consumes the item and keeps the turn', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipHeal(room, activeId, 55);
  const turnBefore = room.match.turnNumber;
  const deadlineBefore = room.match.turnEndsAt;

  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, true);
  assert.equal(player.hp, 85);
  assert.equal(player.inventory[0], null);
  assert.equal(player.selectedItemSlot, 1);
  assert.equal(room.match.activePlayerId, activeId);
  assert.equal(room.match.turnNumber, turnBefore);
  assert.equal(room.match.turnEndsAt, deadlineBefore);
  assert.equal(room.match.projectile, null);
  assert.equal(player.lastUtility?.type, 'heal');
  assert.equal(player.lastUtility?.amount, 30);
});

test('Heal caps at 100 HP and records the actual healed amount', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipHeal(room, activeId, 88);
  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, true);
  assert.equal(player.hp, 100);
  assert.equal(player.lastUtility?.amount, 12);
});

test('Heal cannot be wasted at full HP', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipHeal(room, activeId, 100);
  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'heal_full_hp');
  assert.equal(player.inventory[0]?.type, 'heal');
  assert.equal(player.selectedItemSlot, 2);
});

test('public Phase 6C.1 state advertises Heal rules and pool weight', () => {
  const room = makeStartedRoom();
  const state = publicRoomState6A(room);
  assert.equal(state.phase, '6C.1');
  assert.equal(state.healRules.amount, 30);
  assert.equal(state.healRules.consumesTurn, false);
  const heal = state.itemPool.find(item => item.type === 'heal');
  assert.deepEqual(heal, { type: 'heal', label: 'HEAL +30', weight: 15 });
});
