import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, getRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { setTerrain7A1 } from '../phase7a1.js';
import {
  disconnectPlayer7AHotfix,
  fireProjectile7AHotfix,
  jumpActivePlayer7AHotfix,
  phase7aHotfixTestHooks,
  publicRoomState7AHotfix
} from '../phase7a-hotfix.js';

function started(ids=['a','b'], terrain='rolling'){
  roomStore.clear();
  const [host,...rest]=ids;
  const c=createRoom(host,host.toUpperCase());
  const room=c.room;
  for(const id of rest)assert.equal(joinRoom(room.code,id,id.toUpperCase()).ok,true);
  assert.equal(setGameMode(host,'survival').ok,true);
  if(terrain!=='rolling')assert.equal(setTerrain7A1(host,terrain).ok,true);
  for(const id of ids)assert.equal(setPlayerReady(id,true).ok,true);
  assert.equal(startRoom(host).ok,true);
  activateRoom(room.code,room.match.startAt);
  return getRoom(room.code);
}

test('jump arc cannot phase through a tall terrain step',()=>{
  const room=started(['a','b'],'terraces');
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  active.spawn={x:250,y:Math.round(3520+Math.sin(250/560)*100-8),facing:1};
  active.motion=null;
  active.lastFreeJumpAt=Date.now()-1000;
  const nominalX=430;
  const r=jumpActivePlayer7AHotfix(active.id,1);
  assert.equal(r.ok,true);
  assert.ok(active.spawn.x<nominalX,`expected collision before ${nominalX}, got ${active.spawn.x}`);
  assert.ok(active.motion.toX<nominalX);
});

test('short projectile flights are stretched to at least one visible second without moving the impact point',()=>{
  const room=started(['a','b']);
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  active.spawn={x:1000,y:phase7aHotfixTestHooks.surface(room,1000)-8,facing:1};
  const target=room.players.find(p=>p.id!==active.id);
  target.spawn={x:1120,y:phase7aHotfixTestHooks.surface(room,1120)-8,facing:-1};
  room.match.aimAngle=5;room.match.aimPower=100;
  const r=fireProjectile7AHotfix(active.id);
  assert.equal(r.ok,true);
  const q=room.match.projectile;
  assert.ok(q.impactAt-q.startedAt>=1000);
  assert.ok(q.durationMs>=1000);
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});

test('disconnect during a live survival match does not award a victory',()=>{
  const room=started(['a','b']);
  const nonActive=room.players.find(p=>p.id!==room.match.activePlayerId);
  const r=disconnectPlayer7AHotfix(nonActive.id);
  assert.equal(r.disconnected,true);
  assert.equal(room.status,'started');
  assert.equal(room.match.result,null);
  assert.equal(room.players.length,2);
  assert.equal(nonActive.alive,true);
  assert.equal(nonActive.connected,false);
  const state=publicRoomState7AHotfix(room);
  assert.equal(state.players.find(p=>p.id===nonActive.id).connected,false);
});

test('disconnecting the active player removes only their turn, not their life or the match',()=>{
  const room=started(['a','b']);
  const activeId=room.match.activePlayerId;
  const active=room.players.find(p=>p.id===activeId);
  const r=disconnectPlayer7AHotfix(activeId);
  assert.equal(r.disconnected,true);
  assert.equal(room.status,'started');
  assert.equal(active.alive,true);
  assert.equal(active.connected,false);
  assert.equal(room.match.result,null);
  assert.equal(room.match.turnOrder.includes(activeId),false);
});
