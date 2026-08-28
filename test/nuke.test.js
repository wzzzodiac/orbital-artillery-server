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
import { advanceTurnIfDue6D, fireProjectile6D, jumpActivePlayer6D, moveActivePlayer6D, publicRoomState6D } from '../phase6d.js';

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

test('Nuke Laser consumes item and creates a three-second catastrophic beam sequence', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = equipNuke(room, activeId);
  const turnBefore = room.match.turnNumber;

  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  assert.equal(player.inventory[0], null);
  assert.equal(player.selectedItemSlot, 1);
  assert.equal(room.match.turnNumber, turnBefore);
  const q = room.match.projectile;
  assert.equal(q?.weaponType, 'nuke');
  assert.equal(q.warningUntil - q.targetLockedAt, 3000);
  assert.equal(q.beamUntil - q.beamAt, 3000);
  assert.ok(q?.nukeBeam);
  assert.ok((q.nukeBeam.bx-q.nukeBeam.ax) >= 1500, 'beam should cover a major terrain section');
  assert.ok(Math.abs(q.nukeBeam.by-q.nukeBeam.ay) <= 640, 'beam should stay diagonal across the terrain band instead of becoming near-vertical');
});

test('Nuke Laser terrain destruction only occurs where the diagonal beam intersects the surface', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  equipNuke(room, activeId);
  const result = fireProjectile6D(activeId);
  assert.equal(result.ok, true);
  const q = room.match.projectile;
  const now = Date.now();
  const before = room.arena.craters.length;
  q.nukeBeam = { ax:q.targetX-900, ay:200, bx:q.targetX+900, by:260, halfWidth:115 };
  q.beamAt = now;
  q.beamUntil = now + 10;
  q.resolveAt = now + 100;
  advanceTurnIfDue6D(room.code, now);
  assert.equal(room.arena.craters.length, before, 'terrain far below a displaced beam must not be erased');
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
  q.nukeBeam = { ax:shooter.spawn.x-100, ay:shooter.spawn.y-10, bx:shooter.spawn.x+100, by:shooter.spawn.y-10, halfWidth:115 };
  q.beamAt = now;
  q.beamUntil = now + 20;
  q.resolveAt = now + 200;
  shielded.spawn.x = shooter.spawn.x;
  shielded.spawn.y = shooter.spawn.y;
  far.spawn.x = Math.min(4900, shooter.spawn.x + 1000);

  assert.ok(advanceTurnIfDue6D(room.code, now));
  assert.equal(shooter.hp, 80);
  assert.equal(shielded.hp, 90);
  assert.equal(shielded.shield, null);
  assert.equal(far.hp, 100);
  assert.notEqual(shooter.motion?.type, 'knockback', 'Nuke direct damage must not add conventional knockback');
  assert.notEqual(shooter.motion?.type, 'knockbackVoid', 'Nuke direct damage must not add void knockback');
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
  room.pickups = [{ id:'nuke-box', type:'heal', label:'HEAL +30', x:midX, y:midY, spawnTurn:room.match.turnNumber, expiresAfterTurn:room.match.turnNumber+3, phase6cPoolRolled:true, phase6dPoolRolled:true }];
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

test('Phase 6D movement ignores the old 520 radius during the active turn', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = room.players.find(entry => entry.id === activeId);
  room.terrainPreset='terraces';
  room.arena.terrainPreset='terraces';
  player.spawn={x:1045,y:2912,facing:1};
  player.motion=null;
  room.match.movementOriginX=1045;
  room.match.movementRadius=520;
  const startX=player.spawn.x;
  for(let i=0;i<36;i+=1){
    const moved=moveActivePlayer6D(activeId,1);
    assert.equal(moved.ok,true,`free move ${i+1} should succeed`);
  }
  assert.ok(player.spawn.x-startX>520);
});

test('Phase 6D jump ignores the old two-jump quota and exposes free-movement rules', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = room.players.find(entry => entry.id === activeId);
  room.terrainPreset='terraces';
  room.arena.terrainPreset='terraces';
  player.spawn={x:1100,y:2912,facing:1};
  player.motion=null;
  player.lastFreeJumpAt=0;
  room.match.jumpsRemaining=0;
  const jumped=jumpActivePlayer6D(activeId,1);
  assert.equal(jumped.ok,true);
  assert.equal(player.motion?.type,'jump');
  assert.equal(player.motion.endsAt-player.motion.startedAt,500);
  const state=publicRoomState6D(room);
  assert.equal(state.movementRules.freeDuringTurn,true);
  assert.equal(state.movementRules.jumpsPerTurn,null);
  assert.equal(state.movementRules.jumpCooldownMs,450);
  assert.equal(state.match.movementRadius,null);
  assert.equal(state.match.jumpsRemaining,null);
});

test('free jump into void preserves long fall timing instead of using the 500 ms normal-jump animation', () => {
  const room = makeStartedRoom();
  const activeId = room.match.activePlayerId;
  const player = room.players.find(entry => entry.id === activeId);
  room.terrainPreset='terraces';
  room.arena.terrainPreset='terraces';
  player.spawn={x:2350,y:3240,facing:1};
  player.motion=null;
  player.lastFreeJumpAt=0;
  const jumped=jumpActivePlayer6D(activeId,1);
  assert.equal(jumped.ok,true);
  assert.equal(player.alive,false);
  assert.equal(player.motion?.type,'jump');
  assert.ok(Number(player.motion?.toY)>5000);
  assert.ok(player.motion.endsAt-player.motion.startedAt>=2000,'void jump must retain the long fall/death motion');
});

test('invalid spectator traversal does not mutate shared Phase 6D movement state', () => {
  const room = makeStartedRoom(['a','b','c']);
  const activeId = room.match.activePlayerId;
  const spectator = room.players.find(player => player.id !== activeId);
  room.match.movementOriginX = 777;
  room.match.movementRadius = 520;
  room.match.jumpsRemaining = 2;
  const before = {
    movementOriginX: room.match.movementOriginX,
    movementRadius: room.match.movementRadius,
    jumpsRemaining: room.match.jumpsRemaining,
    spectatorSpawn: { ...spectator.spawn }
  };

  const moved = moveActivePlayer6D(spectator.id, 1);
  assert.equal(moved.ok, false);
  assert.equal(moved.error, 'not_your_turn');
  assert.equal(room.match.movementOriginX, before.movementOriginX);
  assert.equal(room.match.movementRadius, before.movementRadius);
  assert.equal(room.match.jumpsRemaining, before.jumpsRemaining);
  assert.deepEqual(spectator.spawn, before.spectatorSpawn);

  const jumped = jumpActivePlayer6D(spectator.id, 1);
  assert.equal(jumped.ok, false);
  assert.equal(jumped.error, 'not_your_turn');
  assert.equal(room.match.movementOriginX, before.movementOriginX);
  assert.equal(room.match.movementRadius, before.movementRadius);
  assert.equal(room.match.jumpsRemaining, before.jumpsRemaining);
  assert.deepEqual(spectator.spawn, before.spectatorSpawn);
});

test('public Phase 6D state advertises Nuke rarity, cinematic timings and spectator aim', () => {
  const room = makeStartedRoom();
  const state = publicRoomState6D(room);
  assert.equal(state.phase, '6D');
  assert.equal(state.nukeRules.damage, 20);
  assert.equal(state.nukeRules.warningMs, 3000);
  assert.equal(state.nukeRules.beamMs, 3000);
  assert.equal(state.nukeRules.beamVerticalHalfSpan, 320);
  assert.equal(state.nukeRules.knockback, false);
  assert.equal(state.nukeRules.pickups, 'destroy');
  assert.equal(state.nukeRules.fullFriendlyFire, true);
  assert.equal(state.nukeRules.selfDamage, true);
  assert.equal(state.spectatorAim.activePlayerId, room.match.activePlayerId);
  assert.equal(state.spectatorAim.angle, room.match.aimAngle);
  assert.equal(state.spectatorAim.power, room.match.aimPower);
  const item = state.itemPool.find(entry => entry.type === 'nuke');
  assert.deepEqual(item, { type:'nuke', label:'NUKE LASER', weight:3 });
});
