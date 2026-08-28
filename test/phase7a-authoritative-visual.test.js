import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { fireProjectile7AVisual } from '../phase7a-visual.js';

function started(){
  roomStore.clear();
  const room=createRoom('a','A').room;
  assert.equal(joinRoom(room.code,'b','B').ok,true);
  assert.equal(setGameMode('a','survival').ok,true);
  assert.equal(setPlayerReady('a',true).ok,true);
  assert.equal(setPlayerReady('b',true).ok,true);
  assert.equal(startRoom('a').ok,true);
  activateRoom(room.code,room.match.startAt);
  return room;
}

test('bright projectile and authoritative impact share one delayed timeline',()=>{
  const room=started();
  const active=room.match.activePlayerId;
  const before=Date.now();
  const result=fireProjectile7AVisual(active);
  assert.equal(result.ok,true);
  const q=room.match.projectile;
  assert.equal(q.authoritativeVisualDelay7A,850);
  assert.ok(q.startedAt>=before+750,'launch should be held long enough for both clients to receive the shot before it leaves the muzzle');
  assert.ok(q.impactAt>q.startedAt);
  assert.equal(q.impactAt-q.startedAt,q.durationMs,'the visible flight duration must be the same duration used by authoritative impact timing');
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});

test('boxed ballistic projectile keeps the same authoritative duration after launch hold',()=>{
  const room=started();
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  active.inventory=[{type:'heavy',label:'HEAVY BOMB'},null];
  active.selectedItemSlot=2;
  const result=fireProjectile7AVisual(active.id);
  assert.equal(result.ok,true);
  const q=room.match.projectile;
  assert.equal(q.weaponType,'heavy');
  assert.equal(q.authoritativeVisualDelay7A,850);
  assert.ok(q.durationMs>=7000);
  assert.equal(q.impactAt-q.startedAt,q.durationMs);
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});
