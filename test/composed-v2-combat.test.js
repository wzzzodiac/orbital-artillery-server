import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, setGameMode, setPlayerReady, startRoom, activateRoom, roomStore } from '../rooms.js';
// These are the composed exports imported by server.js, not an older phase.
import {
  setTerrain9, publicRoomState9, fireProjectile9, advanceTurnIfDue9,
  moveActivePlayer9, disconnectPlayer9, rematchRoom9, selectItem9, setAim9
} from '../phase11-huancavelica-v2.js';

let clock = 1_800_000_000_000;
function withClock(run) {
  const original = Date.now;
  Date.now = () => clock;
  try { roomStore.clear(); clock += 100_000; run(); }
  finally { Date.now = original; roomStore.clear(); }
}
function started({ mode = 'team', ids = ['a', 'b'], map = 'huancavelica-v2' } = {}) {
  const room = createRoom(ids[0], ids[0].toUpperCase()).room;
  for (const id of ids.slice(1)) assert.equal(joinRoom(room.code, id, id.toUpperCase()).ok, true);
  assert.equal(setGameMode(ids[0], mode).ok, true);
  assert.equal(setTerrain9(ids[0], map).ok, true);
  for (const id of ids) assert.equal(setPlayerReady(id, true).ok, true);
  assert.equal(startRoom(ids[0]).ok, true);
  publicRoomState9(room);
  clock = room.match.startAt;
  activateRoom(room.code, clock);
  publicRoomState9(room);
  room.match.activePlayerId = 'b';
  room.match.turnIndex = room.match.turnOrder.indexOf('b');
  room.match.wind = { signed: 0, strength: 0, direction: 'none' };
  return room;
}
function fire(room, weapon = 'basic') {
  if (weapon !== 'basic') {
    room.players.find(p => p.id === 'b').inventory = [{ type: weapon, label: weapon }, null];
    assert.equal(selectItem9('b', 2).ok, true);
  }
  assert.equal(setAim9('b', 45, 55).ok, true);
  assert.equal(fireProjectile9('b').ok, true);
  return room.match.projectile;
}
function complete(room) {
  for (let ticks = 0; ticks < 160 && room.status === 'started' && room.match.projectile; ticks++) {
    clock += 250;
    advanceTurnIfDue9(room.code, clock);
  }
  assert.equal(room.match.projectile, null, 'attack resolves in bounded time');
  return publicRoomState9(room);
}
function playerState(room) {
  return structuredClone(room.players.map(p => ({ id: p.id, spawn: p.spawn, motion: p.motion, hp: p.hp, alive: p.alive })));
}

for (const mode of ['team', 'survival']) for (const weapon of ['basic', 'heavy']) {
  test(`composed v2 ${mode}/${weapon}: authored 45/55 shot has no phantom death or DRAW`, () => withClock(() => {
    const room = started({ mode });
    assert.deepEqual(room.players.map(p => p.spawn.x), [970, 4009]);
    fire(room, weapon);
    const state = complete(room);
    assert.equal(room.players[0].hp, 100, 'distant player remains unharmed');
    assert.ok(room.players.every(p => p.alive && p.hp > 0), 'both supported players survive');
    assert.equal(state.status, 'started');
    assert.equal(state.match.result, null);
    assert.equal(state.match.pendingResult, null);
    assert.equal(state.deathAttribution && Object.keys(state.deathAttribution).length, 0);
    assert.ok(state.matchStats.every(s => s.kills === 0 && s.deaths === 0 && s.voidDeaths === 0));
    assert.ok(!state.eventFeed.some(e => e.type === 'death'));
    assert.equal(state.matchStats.find(s => s.playerId === 'b').damageReceived, 100 - room.players[1].hp);
    assert.equal(room.arena.craters.length, 1, 'one definitive terrain cut');
  }));
}

test('composed v2 disconnect and repeated serialization preserve survivor state and motion', () => withClock(() => {
  const room = started({ mode: 'survival', ids: ['a', 'b', 'c'] });
  room.match.activePlayerId = 'a';
  room.match.turnIndex = room.match.turnOrder.indexOf('a');
  assert.equal(moveActivePlayer9('a', 1).ok, true);
  room.players[0].hp = 73;
  const before = playerState(room).filter(p => p.id !== 'c');
  assert.ok(before[0].motion);
  assert.equal(disconnectPlayer9('c').deleted, false);
  for (let read = 0; read < 4; read++) publicRoomState9(room);
  assert.deepEqual(playerState(room), before);
  assert.equal(room.status, 'started');
}));

test('composed public-state reads never mutate the authoritative room', () => withClock(() => {
  const room = started();
  room.match.turnNumber = 10; // Previously public reads also spawned/rebalanced pickups.
  const before = structuredClone(room);
  const first = publicRoomState9(room);
  const second = publicRoomState9(room);
  assert.deepEqual(room, before);
  assert.deepEqual(second, first);
}));

for (const mode of ['team', 'survival']) {
  test(`composed v2 ${mode}: simultaneous lethal impact ends once as a real DRAW`, () => withClock(() => {
    const room = started({ mode });
    const q = fire(room);
    for (const p of room.players) { p.spawn = { ...room.players[0].spawn }; p.hp = 1; }
    q.impactX = room.players[0].spawn.x;
    q.impactY = room.players[0].spawn.y - 10;
    q.impactReason = 'player'; q.hitPlayerId = 'a';
    const state = complete(room);
    assert.ok(room.players.every(p => p.hp === 0 && p.alive === false));
    assert.equal(state.status, 'finished');
    assert.equal(state.match.result.draw, true);
    assert.equal(state.match.pendingResult, null, 'no stale pending result after finalization');
    assert.equal(state.matchStats.reduce((n, s) => n + s.deaths, 0), 2);
    const snapshot = structuredClone(room);
    advanceTurnIfDue9(room.code, clock + 5000);
    publicRoomState9(room);
    assert.deepEqual(room, snapshot, 'no resurrection or duplicate finalization');
  }));
}

test('composed v2 legitimate rematch assigns authored spawns and resets damage', () => withClock(() => {
  const room = started();
  room.status = 'finished'; room.match.finishedAt = clock;
  room.match.result = { type: 'team', winnerTeam: 'A', draw: false };
  room.players[0].spawn.x += 100; room.players[0].hp = 12;
  clock += 1000;
  assert.equal(rematchRoom9('a', { randomMap: false }).ok, true);
  assert.deepEqual(room.players.map(p => p.spawn.x), [970, 4009]);
  assert.ok(room.players.every(p => p.hp === 100 && p.alive));
  const before = structuredClone(room);
  publicRoomState9(room);
  assert.deepEqual(room, before);
}));
