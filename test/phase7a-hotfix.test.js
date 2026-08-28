import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, getRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { setTerrain7A1 } from '../phase7a1.js';
import {
  advanceTurnIfDue7AHotfix,
  disconnectPlayer7AHotfix,
  fireProjectile7AHotfix,
  jumpActivePlayer7AHotfix,
  moveActivePlayer7AHotfix,
  phase7aHotfixTestHooks
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

function giveSpecial(room,player,type,label=type.toUpperCase()){
  player.inventory=[{type,label},null];
  player.selectedItemSlot=2;
  player.motion=null;
  room.match.projectile=null;
}

test('jump vaults onto a high terrace without phasing through its side',()=>{
  const room=started(['a','b'],'terraces');
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  const fromX=250,landingX=430;
  active.spawn={x:fromX,y:Math.round(phase7aHotfixTestHooks.surface(room,fromX)-8),facing:1};
  active.motion=null;
  active.lastFreeJumpAt=Date.now()-1000;
  const r=jumpActivePlayer7AHotfix(active.id,1);
  assert.equal(r.ok,true);
  assert.equal(Math.round(active.spawn.x),landingX);
  assert.equal(Math.round(active.spawn.y),Math.round(phase7aHotfixTestHooks.surface(room,landingX)-8));
  assert.ok(active.motion.apex>150,`expected dynamic vault apex, got ${active.motion.apex}`);
});

test('basic projectile has at least three seconds of visible flight',()=>{
  const room=started(['a','b']);
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  active.spawn={x:1000,y:phase7aHotfixTestHooks.surface(room,1000)-8,facing:1};
  const target=room.players.find(p=>p.id!==active.id);
  target.spawn={x:1120,y:phase7aHotfixTestHooks.surface(room,1120)-8,facing:-1};
  room.match.aimAngle=5;room.match.aimPower=100;
  const r=fireProjectile7AHotfix(active.id);
  assert.equal(r.ok,true);
  const q=room.match.projectile;
  assert.ok(q.impactAt-q.startedAt>=3000);
  assert.ok(q.durationMs>=3000);
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});

test('box projectile weapons have at least four seconds of visible flight',()=>{
  const room=started(['a','b']);
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  giveSpecial(room,active,'heavy','HEAVY BOMB');
  const r=fireProjectile7AHotfix(active.id);
  assert.equal(r.ok,true);
  const q=room.match.projectile;
  assert.equal(q.weaponType,'heavy');
  assert.ok(q.impactAt-q.startedAt>=4000);
  assert.ok(q.durationMs>=4000);
});

test('nuke uses four-second designator then five-second warning and five-second beam',()=>{
  const room=started(['a','b']);
  const active=room.players.find(p=>p.id===room.match.activePlayerId);
  giveSpecial(room,active,'nuke','NUKE LASER');
  const r=fireProjectile7AHotfix(active.id);
  assert.equal(r.ok,true);
  const q=room.match.projectile;
  assert.equal(q.weaponType,'nuke');
  assert.ok(q.impactAt-q.startedAt>=4000);
  assert.equal(q.beamAt-q.targetLockedAt,5000);
  assert.equal(q.beamUntil-q.beamAt,5000);
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});

test('repeated two-player turn timeouts never create a winner while both players are alive',()=>{
  const room=started(['a','b']);
  for(let i=0;i<12;i+=1){
    const next=advanceTurnIfDue7AHotfix(room.code,room.match.turnEndsAt+1);
    assert.ok(next);
    assert.equal(room.status,'started');
    assert.equal(room.match.result,null);
    assert.equal(room.players.filter(p=>p.alive!==false).length,2);
  }
});

test('two-player disconnect removes the tank and awards victory to the remaining player',()=>{
  const room=started(['a','b']);
  const leaving=room.players.find(p=>p.id!==room.match.activePlayerId);
  const survivor=room.players.find(p=>p.id!==leaving.id);
  const r=disconnectPlayer7AHotfix(leaving.id);
  assert.ok(r?.room);
  assert.equal(room.players.length,1);
  assert.equal(room.players[0].id,survivor.id);
  assert.equal(room.status,'finished');
  assert.equal(room.match.result.winnerPlayerId,survivor.id);
});

test('three-player active disconnect removes tank and immediately hands a usable turn to a remaining player',()=>{
  const room=started(['a','b','c']);
  const leavingId=room.match.activePlayerId;
  const r=disconnectPlayer7AHotfix(leavingId);
  assert.ok(r?.room);
  assert.equal(room.players.length,2);
  assert.equal(room.players.some(p=>p.id===leavingId),false);
  assert.equal(room.status,'started');
  assert.equal(room.match.result,null);
  assert.ok(room.match.activePlayerId);
  assert.equal(room.players.some(p=>p.id===room.match.activePlayerId),true);
  const before=room.players.find(p=>p.id===room.match.activePlayerId).spawn.x;
  const moved=moveActivePlayer7AHotfix(room.match.activePlayerId,1);
  assert.equal(moved.ok,true);
  assert.notEqual(room.players.find(p=>p.id===room.match.activePlayerId).spawn.x,before);
});

test('three-player non-active disconnect preserves the current active turn',()=>{
  const room=started(['a','b','c']);
  const activeId=room.match.activePlayerId;
  const leaving=room.players.find(p=>p.id!==activeId);
  disconnectPlayer7AHotfix(leaving.id);
  assert.equal(room.players.length,2);
  assert.equal(room.status,'started');
  assert.equal(room.match.activePlayerId,activeId);
  assert.equal(room.match.result,null);
});
