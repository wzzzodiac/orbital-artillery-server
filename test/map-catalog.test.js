import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYABLE_TERRAINS,randomPlayableTerrain} from '../map-catalog.js';
import {createRoom,joinRoom,roomStore,setPlayerReady,startRoom,activateRoom,setTerrainPreset} from '../rooms.js';
import {publicRoomState9,setTerrain9,rematchRoom9} from '../phase11-huancavelica-v2.js';
const active=['rolling','brokenridge','huancavelica-v2'];
const retired=['terraces','twinpeaks','basin','islands','canyon','huancavelica'];
function lobby(){
 roomStore.clear();const room=createRoom('host','Host').room;joinRoom(room.code,'guest','Guest');return room;
}
function start(room){
 setPlayerReady('host',true);setPlayerReady('guest',true);
 assert.equal(startRoom('host').ok,true);activateRoom(room.code,room.match.startAt);
}
function finish(room){
 room.status='finished';room.match.result={type:'team',winnerTeam:'A',draw:false};room.match.finishedAt=Date.now();
}
function assertArena(room,map){
 const state=publicRoomState9(room);assert.equal(state.terrainPreset,map);
 if(map==='huancavelica-v2'){
  assert.equal(state.arena.worldHeight,3750);assert.equal(state.arena.collisionModel,'bitmap-terrain-mask-v2');
  assert.deepEqual(room.players.map(p=>p.spawn.x),[970,4009]);
 }else{
  assert.equal(state.arena.worldHeight,5000);assert.equal(state.arena.collisionModel,undefined);
  assert.equal(state.arena.phase11Theme,undefined);
 }
}
test('public catalog contains exactly maps 1, 5 and Huancavelica for every retained selection',()=>{
 const room=lobby();assert.deepEqual(PLAYABLE_TERRAINS.map(m=>m.id),active);
 for(const map of active){
  assert.equal(setTerrain9('host',map).ok,true);
  publicRoomState9(room); // Let historical lobby telemetry initialize once.
  const before=structuredClone(room),state=publicRoomState9(room);
  assert.equal(state.terrainPreset,map);assert.deepEqual(state.terrainPresets.map(m=>m.id),active);
  assert.deepEqual(room,before,'catalog serialization stays read-only');
 }
});
test('retired maps and malformed choices are rejected without mutating readiness or selection',()=>{
 const room=lobby();setTerrain9('host','huancavelica-v2');setPlayerReady('host',true);
 const before=structuredClone(room);
 for(const map of [...retired,null,{},'../rolling','unknown']){
  assert.deepEqual(setTerrain9('host',map),{ok:false,error:'invalid_terrain'});assert.deepEqual(room,before);
 }
});
test('random and direct choices preserve host authority and cannot run during a match',()=>{
 const room=lobby(),before=structuredClone(room);
 for(const map of [...active,'random'])assert.equal(setTerrain9('guest',map).error,'host_only');
 assert.deepEqual(room,before);start(room);
 const started=structuredClone(room);
 for(const map of [...active,'random'])assert.equal(setTerrain9('host',map).error,'room_already_started');
 assert.deepEqual(room,started);
});
test('random candidate pool can choose each retained destination and always excludes the current map',()=>{
 for(const current of active){
  const destinations=active.filter(id=>id!==current);
  for(let index=0;index<destinations.length;index++){
   assert.equal(randomPlayableTerrain(current,size=>{assert.equal(size,2);return index;}),destinations[index]);
  }
 }
});
test('random lobby selections only use retained maps, reset READY and clear stale bitmap previews',()=>{
 const room=lobby();let previous=publicRoomState9(room).terrainPreset;
 for(let i=0;i<40;i++){
  setPlayerReady('host',true);setPlayerReady('guest',true);
  assert.equal(setTerrain9('host','random').ok,true);
  const state=publicRoomState9(room);
  assert.ok(active.includes(state.terrainPreset));assert.notEqual(state.terrainPreset,previous);
  assert.ok(room.players.every(p=>p.ready===false));assert.equal(room.arena,null);
  previous=state.terrainPreset;
 }
});
test('same-map rematches preserve all three maps and use each map own spawn initialization',()=>{
 for(const map of active){
  const room=lobby();setTerrain9('host',map);start(room);finish(room);
  assert.equal(rematchRoom9('host',{randomMap:false}).ok,true);assertArena(room,map);
  activateRoom(room.code,room.match.startAt);finish(room);
  assert.equal(rematchRoom9('host',null).ok,true);assertArena(room,map);
 }
});
test('random rematches never revive retired maps or carry the previous map collision metadata',()=>{
 const room=lobby();setTerrain9('host','huancavelica-v2');start(room);
 for(let i=0;i<24;i++){
  const previous=publicRoomState9(room).terrainPreset;finish(room);
  assert.equal(rematchRoom9('host',{randomMap:true}).ok,true);
  const state=publicRoomState9(room);assert.ok(active.includes(state.terrainPreset));assert.notEqual(state.terrainPreset,previous);
  assertArena(room,state.terrainPreset);
  assert.equal(state.eventFeed.findLast(e=>e.type==='rematch').randomMap,true);
  activateRoom(room.code,room.match.startAt);
 }
});
test('retired saved heightfields migrate to Rolling Expanse on same-map rematch',()=>{
 for(const map of retired.filter(id=>id!=='huancavelica')){
  const room=lobby();setTerrainPreset('host',map);start(room);finish(room);
  assert.equal(rematchRoom9('host',{randomMap:false}).ok,true);assertArena(room,'rolling');
 }
 roomStore.clear();
});
