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
import { advanceTurnIfDue6D, fireProjectile6D, publicRoomState6D } from '../phase6d.js';

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

function equipNuke(room, playerId) {
  const player = room.players.find(entry => entry.id === playerId);
  room.match.activePlayerId = playerId;
  room.match.projectile = null;
  player.alive = true;
  player.motion = null;
  player.inventory = [{ type:'nuke', label:'NUKE LASER', pickedAtTurn:room.match.turnNumber }, null];
  player.selectedItemSlot = 2;
  return player;
}

test('Nuke Laser consumes item and creates delayed Phase 6D beam state', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipNuke(room, activeId);
  const turnBefore = room.match.turnNumber;

  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  assert.equal(player.inventory[0], null);
  assert.equal(player.selectedItemSlot, 1);
  assert.equal(room.match.turnNumber, turnBefore);
  assert.equal(room.match.projectile?.weaponType, 'nuke');
  assert.ok(room.match.projectile?.warningUntil > Date.now());
  assert.ok(room.match.projectile?.beamAt >= room.match.projectile?.warningUntil);
  assert.ok(room.match.projectile?.nukeBeam);
});

test('Nuke Laser deals 20 direct damage, Shield halves it, and applies no knockback', () => {
  const room = makeStartedRoom(['a', 'b', 'c']);
  const activeId = room.match.activePlayerId;
  const shooter = equipNuke(room, activeId);
  const shielded = room.players.find(entry => entry.id !== activeId);
  const far = room.players.find(entry => entry.id !== activeId && entry.id !== shielded.id);
  shooter.hp = 100;
  shielded.hp = 100;
  shielded.shield = { factor:.5, activatedAt:Date.now(), activatedTurn:room.match.turnNumber };
  far.hp = 100;

  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  q.nukeBeam = { ax:shooter.spawn.x-100, ay:shooter.spawn.y-10, bx:shooter.spawn.x+100, by:shooter.spawn.y-10, halfWidth:88 };
  q.beamAt = now;
  q.beamUntil = now + 20;
  q.resolveAt = now + 200;
  shielded.spawn.x = shooter.spawn.x;
  shielded.spawn.y = shooter.spawn.y;
  far.spawn.x = Math.min(4900, shooter.spawn.x + 1000);
  const shooterMotionBefore = shooter.motion;

  assert.ok(advanceTurnIfDue6D(room.code, now));
  assert.equal(shooter.hp, 80);
  assert.equal(shielded.hp, 90);
  assert.equal(shielded.shield, null);
  assert.equal(far.hp, 100);
  assert.equal(shooter.motion, shooterMotionBefore, 'direct beam hit itself should not create knockback');
});

test('Nuke Laser destroys intersected pickups instead of collecting them', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const shooter = equipNuke(room, activeId);
  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  const midX = (q.nukeBeam.ax + q.nukeBeam.bx) / 2;
  const midY = (q.nukeBeam.ay + q.nukeBeam.by) / 2;
  room.pickups = [{ id:'nuke-box', type:'heal', label:'HEAL +30', x:midX, y:midY, spawnTurn:room.match.turnNumber, expiresAfterTurn:room.match.turnNumber+3, phase6cPoolRolled:true }];
  q.beamAt = now;
  q.beamUntil = now + 10;
  q.resolveAt = now + 100;

  assert.ok(advanceTurnIfDue6D(room.code, now));
  assert.equal(room.pickups.length, 0);
  assert.equal(shooter.inventory.some(item => item?.type === 'heal'), false);
});

test('Nuke Laser always ends the turn after resolution', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  equipNuke(room, activeId);
  const turnBefore = room.match.turnNumber;
  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  q.beamAt = now;
  q.beamUntil = now;
  q.resolveAt = now + 10;
  advanceTurnIfDue6D(room.code, now);
  const resolved = advanceTurnIfDue6D(room.code, now + 11);
  assert.ok(resolved);
  assert.equal(room.match.projectile, null);
  assert.ok(room.match.turnNumber > turnBefore || room.status === 'finished');
});

test('public Phase 6D state advertises Nuke Laser rules and rarity', () => {
  const room = makeStartedRoom();
  const state = publicRoomState6D(room);
  assert.equal(state.phase, '6D');
  assert.equal(state.nukeRules.damage, 20);
  assert.equal(state.nukeRules.knockback, false);
  assert.equal(state.nukeRules.pickups, 'destroy');
  assert.equal(state.nukeRules.fullFriendlyFire, true);
  assert.equal(state.nukeRules.selfDamage, true);
  const item = state.itemPool.find(entry => entry.type === 'nuke');
  assert.deepEqual(item, { type:'nuke', label:'NUKE LASER', weight:3 });
});
