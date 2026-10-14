import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, setGameMode, setPlayerReady, startRoom, activateRoom, roomStore } from '../rooms.js';
// These are the composed exports imported by server.js, not an older phase.
import {
  setTerrain9, publicRoomState9, fireProjectile9, advanceTurnIfDue9,
  moveActivePlayer9, disconnectPlayer9, rematchRoom9, selectItem9, setAim9
} from '../phase11-huancavelica-v2.js';
import { findHuancavelicaV2SurfaceBelow } from '../huancavelica-v2-bitmap.js';

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
    assert.equal(room.arena.craters[0].depth, weapon === 'heavy' ? 90 : 165, 'retain metadata consumed by untouched legacy weapon adapters');
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

for (const mode of ['team', 'survival']) {
  test(`composed v2 ${mode}: real lethal hit records one winner and one kill`, () => withClock(() => {
    const room = started({ mode });
    room.players[0].hp = 5;
    const q = fire(room);
    q.impactX = room.players[0].spawn.x; q.impactY = room.players[0].spawn.y - 10;
    q.impactReason = 'player'; q.hitPlayerId = 'a';
    const state = complete(room);
    assert.equal(state.status, 'finished'); assert.equal(state.match.result.draw, false);
    if (mode === 'team') assert.equal(state.match.result.winnerTeam, room.players[1].team);
    else assert.equal(state.match.result.winnerPlayerId, 'b');
    assert.equal(state.match.pendingResult, null);
    assert.equal(state.matchStats.find(s => s.playerId === 'a').deaths, 1);
    assert.equal(state.matchStats.find(s => s.playerId === 'a').damageReceived, 5);
    assert.equal(state.matchStats.find(s => s.playerId === 'b').kills, 1);
    assert.equal(state.eventFeed.filter(e => e.type === 'death').length, 1);
  }));

  test(`composed v2 ${mode}: genuine bitmap void death has no invented HP damage`, () => withClock(() => {
    const room = started({ mode });
    fire(room);
    // Remove every lower support in this target column, not a legacy hole.
    for (let y = 1300; y <= 3800; y += 500) room.arena.craters.push({ id: `void-fixture-${y}`, x: 970, y, radius: 350 });
    const state = complete(room);
    assert.equal(state.status, 'finished'); assert.equal(state.match.result.draw, false);
    assert.equal(room.players[0].alive, false); assert.equal(room.players[1].alive, true);
    const stats = state.matchStats.find(s => s.playerId === 'a');
    assert.equal(stats.damageReceived, 0); assert.equal(stats.voidDeaths, 1); assert.equal(stats.deaths, 1);
    assert.equal(state.deathAttribution.a.cause, 'terrain_collapse');
    assert.equal(state.match.pendingResult, null);
  }));
}

for (const [weapon, rawDamage] of [['basic', 10], ['heavy', 20]]) {
  test(`composed v2 ${weapon}: final damage and Shield applied once, no temporary KO`, () => withClock(() => {
    const room = started();
    const target = room.players[0]; target.hp = rawDamage / 2 + 2; target.shield = { factor: .5 };
    const q = fire(room, weapon);
    q.impactX = target.spawn.x; q.impactY = target.spawn.y - 10;
    q.impactReason = 'player'; q.hitPlayerId = target.id;
    // An impact above the surface keeps support; direct hits do not knock back.
    const state = complete(room);
    assert.equal(target.hp, 2); assert.equal(target.alive, true); assert.equal(target.shield, null);
    assert.equal(state.status, 'started'); assert.equal(state.match.result, null);
    assert.equal(state.matchStats.find(s => s.playerId === target.id).damageReceived, rawDamage / 2);
    assert.ok(state.matchStats.every(s => s.deaths === 0));
  }));
}

test('composed v2 initialization owns spawns before the first public read', () => withClock(() => {
  const room = createRoom('a', 'A').room; joinRoom(room.code, 'b', 'B');
  setTerrain9('a', 'huancavelica-v2'); setPlayerReady('a', true); setPlayerReady('b', true);
  assert.equal(startRoom('a').ok, true);
  assert.deepEqual(room.players.map(p => p.spawn.x), [970, 4009]);
  assert.equal(room.arena.worldHeight, 3750);
  const before = structuredClone(room); publicRoomState9(room);
  assert.deepEqual(room, before);
}));

test('rejected rematches preserve the room and random rematch initializes only its selected map', () => withClock(() => {
  const room = started();
  const before = structuredClone(room);
  assert.equal(rematchRoom9('b', { randomMap: true }).ok, false);
  assert.equal(rematchRoom9('a', { randomMap: true }).ok, false);
  assert.deepEqual(room, before);
  room.status = 'finished'; room.match.finishedAt = clock;
  room.match.result = {type:'team',winnerTeam:'A',draw:false}; clock += 1000;
  assert.equal(rematchRoom9('a', { randomMap: true }).ok, true);
  assert.notEqual(publicRoomState9(room).terrainPreset, 'huancavelica-v2');
  assert.notEqual(room.arena.worldHeight, 3750);
  assert.notDeepEqual(room.players.map(p => p.spawn.x), [970,4009]);
}));

test('composed v2 knockback lands on bitmap support instead of a legacy void', () => withClock(() => {
  const room = started();
  const q = fire(room), target = room.players[0];
  q.impactX = target.spawn.x + 100; q.impactY = target.spawn.y + 8;
  q.impactReason = 'terrain'; q.hitPlayerId = null;
  clock = q.impactAt; advanceTurnIfDue9(room.code, clock);
  assert.equal(target.alive, true);
  assert.equal(target.motion?.type, 'knockback');
  assert.ok(findHuancavelicaV2SurfaceBelow(room, target.spawn.x, target.spawn.y, 32) != null);
  const state = complete(room);
  assert.ok(state.matchStats.every(s => s.deaths === 0));
  assert.equal(state.match.result, null);
}));

for (const map of ['rolling','terraces','twinpeaks','basin','brokenridge','islands','canyon']) {
  for (const [weapon, damage] of [['basic',10],['heavy',20]]) {
    test(`composed legacy ${map}/${weapon}: existing balanced resolution remains intact`, () => withClock(() => {
      const room = started({ map });
      const q = fire(room, weapon), target = room.players[0];
      q.impactX = target.spawn.x; q.impactY = target.spawn.y - 10;
      q.impactReason = 'player'; q.hitPlayerId = target.id;
      const state = complete(room);
      assert.equal(target.hp, 100 - damage);
      assert.equal(target.alive, true);
      assert.equal(state.match.result, null);
      assert.equal(room.arena.collisionModel, undefined);
      assert.ok(room.arena.craters.length > 0);
      assert.ok(room.arena.craters.every(c => Number.isFinite(c.depth)), 'legacy heightfield cuts preserved');
    }));
  }
}
