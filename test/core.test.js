import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateRoom,
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  roomStore,
  setGameMode,
  setPlayerReady,
  startRoom
} from '../rooms.js';
import { ensureAfkVoteState, toggleAfkSkipVote } from '../afk-vote.js';
import { advanceTurnIfDue6A, publicRoomState6A } from '../phase6a.js';

function makeStartedRoom(ids) {
  roomStore.clear();
  const [host, ...others] = ids;
  const created = createRoom(host, host.toUpperCase());
  assert.equal(created.ok, true);
  const room = created.room;
  for (const id of others) assert.equal(joinRoom(room.code, id, id.toUpperCase()).ok, true);
  assert.equal(setGameMode(host, 'survival').ok, true);
  for (const id of ids) assert.equal(setPlayerReady(id, true).ok, true);
  assert.equal(startRoom(host).ok, true);
  const activated = activateRoom(room.code, room.match.startAt);
  assert.ok(activated);
  return getRoom(room.code);
}

function cloneSpawns(room) {
  return Object.fromEntries(room.players.map(player => [player.id, player.spawn ? { ...player.spawn } : null]));
}

test('active-player disconnect wraps from the last turn slot to the first remaining player', () => {
  const room = makeStartedRoom(['a', 'b', 'c']);
  room.match.turnOrder = ['a', 'b', 'c'];
  room.match.turnIndex = 2;
  room.match.activePlayerId = 'c';
  room.match.turnNumber = 7;
  room.match.turnStartedAt = Date.now();
  room.match.turnEndsAt = Date.now() + 40_000;

  const removal = removePlayer('c');
  assert.ok(removal?.room);
  assert.equal(removal.room.match.activePlayerId, 'a');
  assert.equal(removal.room.match.turnIndex, 0);
  assert.deepEqual(removal.room.match.turnOrder, ['a', 'b']);
});

test('AFK vote auto-passes if a disconnect lowers the majority threshold below existing votes', () => {
  const room = makeStartedRoom(['a', 'b', 'c', 'd', 'e']);
  const now = Date.now();
  room.match.turnOrder = ['a', 'b', 'c', 'd', 'e'];
  room.match.turnIndex = 0;
  room.match.activePlayerId = 'a';
  room.match.turnNumber = 11;
  room.match.turnStartedAt = now - 30_000;
  room.match.turnEndsAt = now + 10_000;
  room.match.projectile = null;

  const initial = ensureAfkVoteState(room, now);
  assert.equal(initial.requiredVotes, 3);
  assert.equal(toggleAfkSkipVote('b', now).skipped, false);
  assert.equal(toggleAfkSkipVote('c', now).skipped, false);

  removePlayer('e');
  const updated = ensureAfkVoteState(room, now + 1);
  assert.equal(updated.requiredVotes, 2);
  assert.equal(updated.votes.length, 2);
  assert.equal(room.match.turnEndsAt, now + 1);
  assert.equal(room.match.lastAfkSkip?.skippedTurnNumber, 11);
});

test('pickup lifetime of four turns is not off by one', () => {
  const room = makeStartedRoom(['a', 'b']);
  room.pickups = [];
  room.lastPickupSpawnTurn = 0;
  room.match.turnNumber = 3;
  const state = publicRoomState6A(room);
  assert.equal(state.pickups.length, 1);
  assert.equal(state.pickups[0].spawnTurn, 3);
  assert.equal(state.pickups[0].expiresAfterTurn, 6);
});

test('Heavy Bomb applies its own shielded direct damage and leaves only the Heavy crater', () => {
  const room = makeStartedRoom(['a', 'b']);
  const shooter = room.players.find(player => player.id === 'a');
  const target = room.players.find(player => player.id === 'b');
  const now = Date.now();
  target.hp = 40;
  target.shield = { factor: 0.5, activatedAt: now - 1000, activatedTurn: room.match.turnNumber };
  const preSpawns = cloneSpawns(room);
  const projectile = {
    id: 'heavy-regression',
    ownerPlayerId: shooter.id,
    startedAt: now - 1000,
    impactAt: now,
    resolveAt: now + 900,
    durationMs: 1000,
    startX: shooter.spawn.x,
    startY: shooter.spawn.y - 24,
    vx: 0,
    vy: 0,
    gravity: 480,
    windAccel: 0,
    impactX: target.spawn.x,
    impactY: target.spawn.y - 10,
    impactReason: 'player',
    hitPlayerId: target.id,
    angle: 45,
    power: 55,
    resolutionApplied: false,
    weaponType: 'heavy',
    resumeTurnMs: 20_000,
    pickupCollected: false,
    preImpactHp: { a: shooter.hp, b: 40 },
    preImpactAlive: { a: true, b: true },
    preImpactSpawns: preSpawns
  };
  room.match.activePlayerId = shooter.id;
  room.match.projectile = projectile;
  room.match.turnEndsAt = projectile.resolveAt;

  const changed = advanceTurnIfDue6A(room.code, now);
  assert.ok(changed);
  assert.equal(target.hp, 10);
  assert.equal(target.alive, true);
  assert.equal(target.shield, null);
  assert.equal(room.arena.craters.some(crater => crater.id === projectile.id), false);
  assert.equal(room.arena.craters.some(crater => crater.id === `${projectile.id}-heavy`), true);
});

test('Triple Shot neutralizes the internal BASIC hit before applying all three special impacts', () => {
  const room = makeStartedRoom(['a', 'b']);
  const shooter = room.players.find(player => player.id === 'a');
  const target = room.players.find(player => player.id === 'b');
  const now = Date.now();
  target.hp = 100;
  target.shield = null;
  const preSpawns = cloneSpawns(room);
  const impact = {
    impactAt: now,
    impactX: target.spawn.x,
    impactY: target.spawn.y - 10,
    impactReason: 'player',
    hitPlayerId: target.id
  };
  const projectile = {
    id: 'triple-regression',
    ownerPlayerId: shooter.id,
    startedAt: now - 1000,
    impactAt: now,
    resolveAt: now + 900,
    durationMs: 1000,
    startX: shooter.spawn.x,
    startY: shooter.spawn.y - 24,
    vx: 0,
    vy: 0,
    gravity: 480,
    windAccel: 0,
    impactX: target.spawn.x,
    impactY: target.spawn.y - 10,
    impactReason: 'player',
    hitPlayerId: target.id,
    angle: 45,
    power: 55,
    resolutionApplied: false,
    weaponType: 'triple',
    resumeTurnMs: 20_000,
    pickupCollected: false,
    specialResolveAt: now,
    volley: [{ ...impact }, { ...impact }, { ...impact }],
    preImpactHp: { a: shooter.hp, b: 100 },
    preImpactAlive: { a: true, b: true },
    preImpactSpawns: preSpawns
  };
  room.match.activePlayerId = shooter.id;
  room.match.projectile = projectile;
  room.match.turnEndsAt = projectile.resolveAt;

  const changed = advanceTurnIfDue6A(room.code, now);
  assert.ok(changed);
  assert.equal(target.hp, 40);
  assert.equal(target.alive, true);
  assert.equal(projectile.baseNeutralized, true);
  assert.equal(projectile.specialResolutionApplied, true);
  assert.equal(room.arena.craters.some(crater => crater.id === projectile.id), false);
});
