import test from 'node:test';
import assert from 'node:assert/strict';
import { onClientEvent, isValidClientPayload } from '../client-events.js';
import { normalizePlayerName, isValidRoomCode } from '../validation.js';
import { createRoom, joinRoom, roomStore } from '../rooms.js';
import { setTerrain9, publicRoomState9 } from '../phase10-huancavelica.js';

test('protocol schemas accept frontend payloads and reject coercible objects', () => {
  const valid = {
    create_room: { name: 'Player' }, join_room: { name: 'Player', code: 'ABCD' },
    set_mode: { mode: 'survival' }, set_terrain: { terrain: 'huancavelica' },
    set_ready: { ready: true }, set_team: { team: 'A' }, start_game: {},
    rematch_game: { randomMap: true }, move_player: { direction: -1 },
    jump_player: { direction: 1 }, set_aim: { angle: 45, power: 50 },
    select_item: { slot: 2 }, fire_projectile: {}, toggle_afk_skip_vote: {}
  };
  for (const [event, payload] of Object.entries(valid)) {
    assert.equal(isValidClientPayload(event, payload), true, event);
    for (const malformed of [null, [], 'text', 0, { ...payload, unexpected: true }]) {
      assert.equal(isValidClientPayload(event, malformed), false, event);
    }
    for (const key of Object.keys(payload)) {
      assert.equal(isValidClientPayload(event, { ...payload, [key]: { toString: null } }), false, `${event}.${key}`);
    }
  }
  assert.equal(isValidClientPayload('set_aim', { angle: 48 }), true);
  assert.equal(isValidClientPayload('set_aim', { power: 55 }), true);
  for (const value of [NaN, Infinity, -Infinity, '45', null]) {
    assert.equal(isValidClientPayload('set_aim', { angle: value }), false);
  }
  assert.equal(isValidClientPayload('set_ready', { ready: 'false' }), false);
  assert.equal(isValidClientPayload('set_mode', Object.create({ mode: 'team' })), false);
  assert.equal(isValidClientPayload('toString', {}), false);
  assert.equal(normalizePlayerName({ toString: null }), '');
  assert.equal(isValidRoomCode({ toString: null }), false);
  assert.equal(normalizePlayerName(' Player '), 'Player');
});

test('event boundary rejects extra arguments and catches sync/async errors', async () => {
  let listener, calls = 0;
  const socket = { on(_event, fn) { listener = fn; } };
  onClientEvent(socket, 'set_mode', () => { calls++; });
  await listener({ mode: 'team' }, null);
  await listener({ mode: 'team' }, {}, () => {});
  await listener({ mode: { toString: null } });
  assert.equal(calls, 0);
  await listener({ mode: 'team' });
  assert.equal(calls, 1, 'valid packets without acknowledgements still work');
  for (const handler of [() => { throw new Error('private detail'); }, async () => { throw new Error('private detail'); }]) {
    onClientEvent(socket, 'start_game', handler);
    let reply;
    await listener({}, value => { reply = value; });
    assert.deepEqual(reply, { ok: false, error: 'internal_error' });
  }
  onClientEvent(socket, 'start_game', (_payload, reply) => reply({ ok: true }));
  await assert.doesNotReject(listener({}, () => { throw new Error('closed transport'); }));
});

test('rejected terrain requests preserve the whole room in every state', () => {
  for (const status of ['lobby', 'countdown', 'started', 'finished']) {
    for (const [actor, terrain] of [['guest', 'rolling'], ['guest', 'huancavelica'], ['host', 'invalid'], ['host', { toString: null }], ['outsider', 'rolling']]) {
      roomStore.clear();
      const room = createRoom('host', 'Host').room;
      joinRoom(room.code, 'guest', 'Guest');
      assert.equal(setTerrain9('host', 'huancavelica').ok, true);
      room.status = status;
      room.players.forEach(player => { player.phase10PlatformId = 'top-center'; player.ready = true; });
      const before = structuredClone(room);
      assert.equal(setTerrain9(actor, terrain).ok, false);
      assert.deepEqual(room, before, `${actor}/${status}/${typeof terrain}`);
    }
    if (status !== 'lobby') {
      const room = [...roomStore.values()][0];
      const before = structuredClone(room);
      assert.equal(setTerrain9('host', 'rolling').ok, false);
      assert.deepEqual(room, before);
    }
  }
  roomStore.clear();
});

test('host can switch aliases and ready state resets on the same collision base', () => {
  roomStore.clear();
  const room = createRoom('host', 'Host').room;
  joinRoom(room.code, 'guest', 'Guest');
  assert.equal(setTerrain9('host', 'huancavelica').ok, true);
  assert.equal(publicRoomState9(room).terrainPreset, 'huancavelica');
  room.players.forEach(player => { player.ready = true; });
  assert.equal(setTerrain9('host', 'islands').ok, true);
  assert.equal(room.phase10TerrainAlias, null);
  assert.equal(room.phase10MapRevision, null);
  assert.ok(room.players.every(player => !player.ready && player.phase10PlatformId === null));
  assert.equal(setTerrain9('host', 'huancavelica').ok, true);
  assert.equal(setTerrain9('host', 'random').ok, true);
  assert.equal(room.phase10TerrainAlias, null);
  roomStore.clear();
});
