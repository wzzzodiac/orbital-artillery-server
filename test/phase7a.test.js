import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateRoom,
  createRoom,
  getRoom,
  joinRoom,
  roomStore,
  setAim,
  setGameMode,
  setPlayerReady,
  setPlayerTeam,
  startRoom
} from '../rooms.js';
import {
  advanceTurnIfDue6E,
  fireProjectile6E,
  jumpActivePlayer6E,
  moveActivePlayer6E,
  publicRoomState6E,
  selectItem6E
} from '../phase6e.js';

function startMatch(ids, { mode = 'survival', teams = null } = {}) {
  roomStore.clear();
  const [host, ...others] = ids;
  const created = createRoom(host, host.toUpperCase());
  assert.equal(created.ok, true);
  const room = created.room;
  for (const id of others) assert.equal(joinRoom(room.code, id, id.toUpperCase()).ok, true);
  assert.equal(setGameMode(host, mode).ok, true);
  if (mode === 'team' && teams) {
    for (const [id, team] of Object.entries(teams)) assert.equal(setPlayerTeam(id, team).ok, true);
  }
  for (const id of ids) assert.equal(setPlayerReady(id, true).ok, true);
  assert.equal(startRoom(host).ok, true);
  assert.ok(activateRoom(room.code, room.match.startAt));
  return getRoom(room.code);
}

test('Phase 7A: eight-player Survival timeout cycle visits every living player once before repeating', () => {
  const ids = ['p1','p2','p3','p4','p5','p6','p7','p8'];
  const room = startMatch(ids);
  const order = [...room.match.turnOrder];
  assert.equal(order.length, 8);
  assert.equal(new Set(order).size, 8);

  const visited = [];
  for (let index = 0; index < order.length; index += 1) {
    visited.push(room.match.activePlayerId);
    const dueAt = room.match.turnEndsAt;
    const changed = advanceTurnIfDue6E(room.code, dueAt + 1);
    assert.ok(changed);
  }

  assert.deepEqual(visited, order);
  assert.equal(room.match.activePlayerId, order[0]);
  assert.equal(room.match.turnNumber, 9);
});

test('Phase 7A: balanced Team 2v2 turn order alternates teams around the whole cycle', () => {
  const room = startMatch(['a1','b1','a2','b2'], {
    mode: 'team',
    teams: { a1:'A', b1:'B', a2:'A', b2:'B' }
  });
  const order = room.match.turnOrder;
  assert.equal(order.length, 4);
  const teamById = Object.fromEntries(room.players.map(player => [player.id, player.team]));
  for (let index = 0; index < order.length; index += 1) {
    const currentTeam = teamById[order[index]];
    const nextTeam = teamById[order[(index + 1) % order.length]];
    assert.notEqual(currentTeam, nextTeam);
  }
});

test('Phase 7A: public spectator aim mirrors authoritative angle, power and selected special', () => {
  const room = startMatch(['a','b']);
  const activeId = room.match.activePlayerId;
  const active = room.players.find(player => player.id === activeId);
  active.inventory = [{ type:'airstrike', label:'AIR STRIKE' }, null];
  active.selectedItemSlot = 1;

  assert.equal(setAim(activeId, 67, 83).ok, true);
  assert.equal(selectItem6E(activeId, 2).ok, true);

  const state = publicRoomState6E(room);
  assert.deepEqual(state.spectatorAim, {
    activePlayerId: activeId,
    angle: 67,
    power: 83,
    selectedItemType: 'airstrike'
  });
  assert.equal(state.players.find(player => player.id === activeId).selectedItemSlot, 2);
});

test('Phase 7A: free movement exceeds the old 520-unit envelope without movement_limit', () => {
  const room = startMatch(['a','b']);
  const activeId = room.match.activePlayerId;
  const active = room.players.find(player => player.id === activeId);
  active.spawn = { ...active.spawn, x: 1200 };
  room.match.movementOriginX = active.spawn.x;
  room.match.movementRadius = 520;

  const startX = active.spawn.x;
  for (let step = 0; step < 36; step += 1) {
    const result = moveActivePlayer6E(activeId, 1);
    assert.equal(result.ok, true, `move ${step + 1} failed with ${result.error ?? 'unknown'}`);
  }
  assert.ok(active.spawn.x - startX > 520);
  const state = publicRoomState6E(room);
  assert.equal(state.match.movementRadius, null);
  assert.equal(state.movementRules.freeDuringTurn, true);
});

test('Phase 7A: active player can perform more than two jumps when cooldown/motion have elapsed', () => {
  const room = startMatch(['a','b']);
  const activeId = room.match.activePlayerId;
  const active = room.players.find(player => player.id === activeId);
  active.spawn = { ...active.spawn, x: 1200 };

  for (let jump = 0; jump < 3; jump += 1) {
    active.motion = null;
    active.lastFreeJumpAt = Date.now() - 1000;
    const result = jumpActivePlayer6E(activeId, 1);
    assert.equal(result.ok, true, `jump ${jump + 1} failed with ${result.error ?? 'unknown'}`);
  }
  assert.equal(room.match.jumpsRemaining, null);
  const state = publicRoomState6E(room);
  assert.equal(state.movementRules.jumpsPerTurn, null);
  assert.equal(state.movementRules.jumpCooldownMs, 450);
});

test('Phase 7A: projectile resolution locks movement for the active player', () => {
  const room = startMatch(['a','b']);
  const activeId = room.match.activePlayerId;
  const fired = fireProjectile6E(activeId);
  assert.equal(fired.ok, true);
  assert.ok(room.match.projectile);

  const move = moveActivePlayer6E(activeId, 1);
  assert.equal(move.ok, false);
  assert.equal(move.error, 'shot_in_flight');
});
