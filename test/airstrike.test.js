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
import { advanceTurnIfDue6A, fireProjectile6A, publicRoomState6A } from '../phase6c.js';

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

function equipAirStrike(room, playerId) {
  const player = room.players.find(entry => entry.id === playerId);
  room.match.activePlayerId = playerId;
  room.match.projectile = null;
  player.alive = true;
  player.motion = null;
  player.inventory = [{ type:'airstrike', label:'AIR STRIKE', pickedAtTurn:room.match.turnNumber }, null];
  player.selectedItemSlot = 2;
  return player;
}

test('Air Strike consumes the item, creates a warning and keeps damage delayed', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipAirStrike(room, activeId);
  const hpBefore = room.players.map(entry => entry.hp);
  const turnBefore = room.match.turnNumber;

  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, true);
  assert.equal(player.inventory[0], null);
  assert.equal(player.selectedItemSlot, 1);
  assert.equal(room.match.turnNumber, turnBefore);
  assert.equal(room.match.projectile?.weaponType, 'airstrike');
  assert.equal(room.match.projectile?.airStrikeShells?.length, 7);
  assert.ok(room.match.projectile.warningUntil > Date.now());
  assert.deepEqual(room.players.map(entry => entry.hp), hpBefore);
});

test('Air Strike applies full self damage and enemy damage without team exemptions', () => {
  const room = makeStartedRoom(['a', 'b', 'c']);
  const activeId = room.match.activePlayerId;
  const shooter = equipAirStrike(room, activeId);
  const enemy = room.players.find(entry => entry.id !== activeId);
  const third = room.players.find(entry => entry.id !== activeId && entry.id !== enemy.id);
  shooter.hp = 100;
  enemy.hp = 100;
  third.hp = 100;

  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  for (const shell of q.airStrikeShells) {
    shell.x = shooter.spawn.x;
    shell.y = shooter.spawn.y - 10;
    shell.impactAt = now;
  }
  q.resolveAt = now + 900;
  q.specialResolveAt = now;
  enemy.spawn.x = shooter.spawn.x;
  enemy.spawn.y = shooter.spawn.y;
  third.spawn.x = Math.min(4900, shooter.spawn.x + 900);

  const changed = advanceTurnIfDue6A(room.code, now);
  assert.ok(changed);
  assert.ok(shooter.hp < 100, 'shooter should take self damage');
  assert.ok(enemy.hp < 100, 'enemy should take damage');
  assert.equal(third.hp, 100, 'far player should remain unharmed');
});

test('Air Strike pickup capture keeps the shooter turn after resolution', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const shooter = equipAirStrike(room, activeId);
  shooter.inventory = [{ type:'airstrike', label:'AIR STRIKE', pickedAtTurn:room.match.turnNumber }, null];
  shooter.selectedItemSlot = 2;
  const oldTurn = room.match.turnNumber;

  const result = fireProjectile6A(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  const shell = q.airStrikeShells[0];
  room.pickups = [{ id:'air-box', type:'heal', label:'HEAL +30', x:shell.x, y:shell.y, spawnTurn:oldTurn, expiresAfterTurn:oldTurn+3, phase6cPoolRolled:true }];
  for (const entry of q.airStrikeShells) entry.impactAt = now;
  q.specialResolveAt = now;
  q.resolveAt = now + 10;

  advanceTurnIfDue6A(room.code, now);
  const resolved = advanceTurnIfDue6A(room.code, now + 11);
  assert.ok(resolved);
  assert.equal(room.match.activePlayerId, activeId);
  assert.equal(room.match.turnNumber, oldTurn);
  assert.equal(room.match.projectile, null);
  assert.equal(shooter.inventory.some(item => item?.type === 'heal'), true);
});

test('public Phase 6C.2 state advertises Air Strike rules and weight', () => {
  const room = makeStartedRoom();
  const state = publicRoomState6A(room);
  assert.equal(state.phase, '6C.2');
  assert.equal(state.airStrikeRules.shells, 7);
  assert.equal(state.airStrikeRules.warningMs, 1200);
  assert.equal(state.airStrikeRules.fullFriendlyFire, true);
  assert.equal(state.airStrikeRules.selfDamage, true);
  const item = state.itemPool.find(entry => entry.type === 'airstrike');
  assert.deepEqual(item, { type:'airstrike', label:'AIR STRIKE', weight:8 });
});
