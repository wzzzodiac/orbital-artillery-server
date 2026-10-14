import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, setPlayerReady, startRoom, activateRoom, roomStore } from '../rooms.js';
import { setTerrain9, publicRoomState9, fireProjectile9, advanceTurnIfDue9 } from '../phase11-huancavelica-v2.js';
import { isHuancavelicaV2Solid } from '../huancavelica-v2-bitmap.js';

let now = 1_800_000_000_000;
function fixture(weapon, run) {
  const original = Date.now; Date.now = () => now; roomStore.clear(); now += 100_000;
  try {
    const room = createRoom('a', 'A').room; joinRoom(room.code, 'b', 'B');
    setTerrain9('a', 'huancavelica-v2'); setPlayerReady('a', true); setPlayerReady('b', true); startRoom('a');
    now = room.match.startAt; activateRoom(room.code, now); publicRoomState9(room);
    room.match.activePlayerId = 'b'; room.match.turnIndex = room.match.turnOrder.indexOf('b');
    room.match.wind = { signed: 0, strength: 0, direction: 'none' };
    const shooter = room.players[1]; shooter.inventory = [{type:weapon,label:weapon},null]; shooter.selectedItemSlot = 2;
    assert.equal(fireProjectile9('b').ok, true);
    run(room, room.match.projectile);
  } finally { Date.now = original; roomStore.clear(); }
}
function advance(room, time) { now = time; return advanceTurnIfDue9(room.code, now); }

test('CSW-04 composed: child geometry originates at the corrected bitmap parent, not legacy X=1714', () => fixture('cluster', (room, q) => {
  assert.ok(Math.abs(q.impactX - 3824.774) < 1, 'reproduce the audited final parent');
  assert.ok(isHuancavelicaV2Solid(room, q.impactX, q.impactY));
  assert.equal(q.clusterImpacts.length, 5);
  assert.ok(q.clusterImpacts.every(child => Math.abs(child.x - q.impactX) < 700), 'children must not stay 2110 units away');
}));

test('CSW-05 composed: final Nuke target in solid rock is actually removed', () => fixture('nuke', (room, q) => {
  const {impactX:x, impactY:y} = q;
  assert.ok(Math.abs(x - 3824.774) < 1 && isHuancavelicaV2Solid(room,x,y));
  advance(room, q.beamAt);
  assert.ok(room.arena.craters.length > 0, 'beam creates bitmap cuts at its final geometry');
  assert.equal(isHuancavelicaV2Solid(room,x,y), false, 'contact rock must not remain solid');
}));

test('CSW-06 composed: central Air Strike shell cuts its upper contact, never the legacy parent island', () => fixture('airstrike', (room, q) => {
  const shell = q.airStrikeShells[3];
  assert.ok(Math.abs(shell.y - 511.05) < 1, 'reproduce audited upper-island shell');
  advance(room, shell.impactAt);
  const crater = room.arena.craters.find(c => c.id === `${q.id}-air-${shell.index}` || c.impactId === shell.id);
  assert.ok(crater, 'central shell has its own crater');
  assert.ok(Math.abs(crater.y - shell.y) < 4, `shell y=${shell.y}, crater y=${crater.y}`);
}));
