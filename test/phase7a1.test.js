import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, getRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { fireProjectile7A1, phase7a1TestHooks, publicRoomState7A1, rematchRoom7A1, setTerrain7A1 } from '../phase7a1.js';

function started(ids=['a','b']){
  roomStore.clear();const [host,...rest]=ids;const c=createRoom(host,host.toUpperCase());const room=c.room;
  for(const id of rest)assert.equal(joinRoom(room.code,id,id.toUpperCase()).ok,true);
  assert.equal(setGameMode(host,'survival').ok,true);for(const id of ids)assert.equal(setPlayerReady(id,true).ok,true);
  assert.equal(startRoom(host).ok,true);activateRoom(room.code,room.match.startAt);return getRoom(room.code);
}

test('Phase 7A.1 public state exposes zeroed authoritative match stats and event feed',()=>{
  const room=started(['a','b','c']);const state=publicRoomState7A1(room);
  assert.equal(state.phase,'7A.1');assert.equal(state.matchStats.length,3);assert.deepEqual(state.eventFeed,[]);
  for(const s of state.matchStats){assert.equal(s.damageDealt,0);assert.equal(s.damageReceived,0);assert.equal(s.kills,0);assert.equal(s.assists,0);assert.equal(s.pickups,0);assert.equal(s.biggestHit,0);assert.equal(s.shotsFired,0);assert.deepEqual(s.weaponUses,{});}
});

test('successful special use increments authoritative weapon usage telemetry',()=>{
  const room=started(['a','b']);const active=room.players.find(p=>p.id===room.match.activePlayerId);active.inventory=[{type:'shield',label:'SHIELD'},null];active.selectedItemSlot=2;
  const r=fireProjectile7A1(active.id);assert.equal(r.ok,true);const state=publicRoomState7A1(room);const stats=state.matchStats.find(s=>s.playerId===active.id);
  assert.equal(stats.shotsFired,1);assert.equal(stats.weaponUses.shield,1);assert.equal(active.shield?.factor,.5);assert.ok(state.eventFeed.some(e=>e.type==='utility'));
});

test('self damage counts as received but never inflates dealt damage or biggest hit',()=>{
  const room=started(['a','b']);const p=room.players[0];const before=phase7a1TestHooks.snapshot(room);const now=Date.now();p.hp=72;p.lastDamage={amount:28,at:now,sourcePlayerId:p.id};
  phase7a1TestHooks.observe(room,before,{sourceId:p.id,weaponType:'basic'});const stats=publicRoomState7A1(room).matchStats.find(s=>s.playerId===p.id);
  assert.equal(stats.damageReceived,28);assert.equal(stats.damageDealt,0);assert.equal(stats.biggestHit,0);
});

test('impact damage is preserved when the same resolution also sends the target into the void',()=>{
  const room=started(['a','b']);const shooter=room.players[0],target=room.players[1],before=phase7a1TestHooks.snapshot(room),now=Date.now();
  target.hp=0;target.alive=false;target.spawn={...target.spawn,y:5120};target.motion={type:'knockbackVoid',startedAt:now,endsAt:now+500,toX:target.spawn.x,toY:5120};target.lastDamage={amount:23,at:now,sourcePlayerId:shooter.id};
  phase7a1TestHooks.observe(room,before,{sourceId:shooter.id,weaponType:'basic'});const state=publicRoomState7A1(room),s=state.matchStats.find(x=>x.playerId===shooter.id),t=state.matchStats.find(x=>x.playerId===target.id);
  assert.equal(s.damageDealt,23);assert.equal(s.biggestHit,23);assert.equal(s.kills,1);assert.equal(t.damageReceived,23);assert.equal(t.voidDeaths,1);assert.equal(state.deathAttribution[target.id].cause,'terrain_collapse');
});

test('host rematch resets combat state while preserving players mode teams and same terrain',()=>{
  const room=started(['a','b']);const terrain=room.terrainPreset;const p=room.players[0];
  p.hp=37;p.alive=false;p.inventory=[{type:'heavy',label:'HEAVY BOMB'},null];p.selectedItemSlot=2;p.shield={factor:.5};room.status='finished';room.match.result={type:'survival',winnerPlayerId:'b',winnerName:'B',draw:false};room.match.finishedAt=Date.now();
  const r=rematchRoom7A1('a',{randomMap:false});assert.equal(r.ok,true);assert.equal(r.room.status,'countdown');assert.equal(r.room.terrainPreset,terrain);assert.equal(r.room.mode,'survival');
  for(const player of r.room.players){assert.equal(player.hp,100);assert.equal(player.alive,true);assert.deepEqual(player.inventory,[null,null]);assert.equal(player.selectedItemSlot,1);assert.equal(player.shield,null);}
});

test('random rematch selects a different concrete terrain and keeps the same room',()=>{
  const room=started(['a','b']);const code=room.code,old=room.terrainPreset;room.status='finished';room.match.result={type:'survival',winnerPlayerId:'a',winnerName:'A',draw:false};room.match.finishedAt=Date.now();
  const r=rematchRoom7A1('a',{randomMap:true});assert.equal(r.ok,true);assert.equal(r.room.code,code);assert.notEqual(r.room.terrainPreset,old);assert.ok(['rolling','terraces','twinpeaks','basin','brokenridge','islands','canyon'].includes(r.room.terrainPreset));
});

test('lobby RANDOM terrain resolves to a concrete map and resets READY states',()=>{
  roomStore.clear();const c=createRoom('a','A');const room=c.room;joinRoom(room.code,'b','B');setPlayerReady('a',true);setPlayerReady('b',true);const old=room.terrainPreset;
  const r=setTerrain7A1('a','random');assert.equal(r.ok,true);assert.notEqual(r.room.terrainPreset,old);assert.equal(r.room.players.every(p=>p.ready===false),true);
});

test('non-host cannot trigger a rematch',()=>{
  const room=started(['a','b']);room.status='finished';room.match.result={type:'survival',winnerPlayerId:'a',winnerName:'A',draw:false};
  const r=rematchRoom7A1('b',{});assert.equal(r.ok,false);assert.equal(r.error,'host_only');
});
