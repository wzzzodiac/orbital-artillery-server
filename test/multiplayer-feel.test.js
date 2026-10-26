import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRoom,joinRoom,setPlayerReady,activateRoom,roomStore,returnToLobby,beginTurn} from '../rooms.js';
import * as game from '../phase12-themed-maps.js';
import {createGameplayCore} from '../simulation/core.js';
import {practiceProfile} from '../simulation/practice-profiles.js';
import {THEMED_BITMAP_MAPS} from '../themed-bitmap.js';
const profile=practiceProfile('reference-v1'),realNow=Date.now;
let clock=1_800_000_000_000;
function run(fn){roomStore.clear();clock+=100000;Date.now=()=>clock;try{fn();}finally{Date.now=realNow;roomStore.clear();}}
function setup(map){
 roomStore.clear();
 const room=createRoom('a','A').room;joinRoom(room.code,'b','B');
 assert.equal(game.setTerrain9('a',map).ok,true);
 setPlayerReady('a',true);setPlayerReady('b',true);assert.equal(game.startRoom('a').ok,true);
 clock=room.match.startAt;activateRoom(room.code,clock);room.match.wind={signed:0,strength:0,direction:'none'};
 const config=THEMED_BITMAP_MAPS[map],folder=config?.folder??'huancavelica-v2';
 const mask=new Uint8Array(readFileSync(new URL('../assets/'+folder+'-terrain-mask.bin',import.meta.url)));
 return {room,core:createGameplayCore(mask,{practice:true,tuning:profile,terrainConfig:config?.geometry}),
  runtime:game.themedBitmapTestHooks.runtimes[map]};
}
for(const map of ['rolling','brokenridge','huancavelica-v2']){
 test(map+': production jump, air steering and gravity match Try It frame by frame',()=>run(()=>{
  const {room,core}=setup(map),id=room.match.activePlayerId,p=room.players.find(p=>p.id===id),expected=structuredClone(room);
  assert.equal(game.jumpActivePlayer9(id).ok,true);assert.equal(core.command(expected,id,'jump_player',{},clock).ok,true);
  assert.equal(p.airborne.vy,-1600);
  for(let frame=1;frame<=50;frame++){
   if(frame===2||frame===7){const direction=frame===2?1:0;game.setAirInput11(id,direction);core.command(expected,id,'air_input',{direction},clock);}
   clock+=20;game.advanceTurnIfDue9(room.code,clock);core.tick(expected,clock);
   const other=expected.players.find(p=>p.id===id);
   assert.deepEqual(p.spawn,other.spawn,'position at frame '+frame);
   assert.deepEqual(p.airborne,other.airborne,'velocity at frame '+frame);
  }
  assert.equal(game.publicRoomState9(room).gameplay.air.gravity,2600);
 }));
 test(map+': Basic and special launch/impact timing matches Try It',()=>run(()=>{
  for(const weapon of ['basic','heavy','triple','cluster','airstrike','nuke']){
   const {room,core}=setup(map),id=room.match.activePlayerId,p=room.players.find(p=>p.id===id);
   if(weapon!=='basic'){p.inventory=[{type:weapon,label:weapon},null];game.selectItem9(id,2);}
   game.setAim9(id,65,18);const expected=structuredClone(room);
   assert.equal(game.fireProjectile9(id).ok,true);assert.equal(core.command(expected,id,'fire_projectile',{},clock).ok,true);
   const actual=room.match.projectile,wanted=expected.match.projectile;
   for(const key of ['startedAt','impactAt','resolveAt','durationMs','impactX','impactY','vx','vy','gravity','windAccel'])assert.equal(actual[key],wanted[key],weapon+'/'+key);
   assert.equal(room.match.turnEndsAt,actual.resolveAt);
   if(weapon==='basic'){assert.equal(actual.startedAt-clock,90);assert.ok(actual.durationMs<4000);}
  }
 }));
 test(map+': losing support drops an inactive player with Try It gravity',()=>run(()=>{
  const {room,core}=setup(map),p=room.players.find(p=>p.id!==room.match.activePlayerId),y=p.spawn.y;
  room.arena.craters.push({id:'floor',x:p.spawn.x,y:y+18,radius:130});const expected=structuredClone(room);
  for(let frame=0;frame<10;frame++){
   game.advanceTurnIfDue9(room.code,clock);core.tick(expected,clock);clock+=20;
   assert.deepEqual(p.spawn,expected.players.find(x=>x.id===p.id).spawn);
  }
  assert.ok(p.spawn.y>y);assert.ok(p.airborne);
 }));
}
test('held walking is timed by the server, ignores duplicate step packets and stops on release/turn change/disconnect',()=>run(()=>{
 const {room,runtime:r}=setup('huancavelica-v2'),id=room.match.activePlayerId,p=room.players.find(p=>p.id===id);
 const expected=structuredClone(room),copy=expected.players.find(p=>p.id===id);
 assert.equal(game.setAirInput11(id,1).ok,true);r.physics.setV2AirInput(copy,1);
 const initial=p.spawn.x;
 for(let frame=0;frame<4;frame++){
  game.moveActivePlayer9(id,1);game.moveActivePlayer9(id,1); // Older clients must not double the speed.
  game.advanceTurnIfDue9(room.code,clock);r.physics.walkV2Player(expected,copy,1,clock);
  assert.deepEqual(p.spawn,copy.spawn);clock+=50;
 }
 assert.ok(p.spawn.x>initial);
 game.setAirInput11(id,0);const stopped=p.spawn.x;game.advanceTurnIfDue9(room.code,clock);assert.equal(p.spawn.x,stopped);
 game.setAirInput11(id,1);beginTurn(room,room.match.turnIndex+1,clock);game.advanceTurnIfDue9(room.code,clock);
 assert.equal(p.v2HorizontalInput,0);assert.equal(p.spawn.x,stopped);
 const active=room.players.find(p=>p.id===room.match.activePlayerId);game.setAirInput11(active.id,1);active.connected=false;
 const disconnectedX=active.spawn.x;clock+=50;game.advanceTurnIfDue9(room.code,clock);assert.equal(active.spawn.x,disconnectedX);assert.equal(active.v2HorizontalInput,0);
}));
test('host can cancel a live shot to lobby, preserving the party/map/looks and clearing all match state',()=>run(()=>{
 const {room}=setup('huancavelica-v2'),id=room.match.activePlayerId;
 room.players[0].appearance={animal:'fox',cart:'tico'};const terrain=game.publicRoomState9(room).terrainPreset;
 assert.equal(game.fireProjectile9(id).ok,true);assert.ok(room.match.projectile);
 assert.equal(returnToLobby('b').error,'host_only');assert.ok(room.match.projectile);
 const code=room.code;assert.equal(returnToLobby('a').ok,true);
 assert.equal(room.code,code);assert.equal(room.status,'lobby');assert.equal(room.match,null);assert.equal(room.arena,null);
 assert.equal(game.advanceTurnIfDue9(code,clock+10000),null);
 assert.equal(game.publicRoomState9(room).terrainPreset,terrain);assert.deepEqual(room.players[0].appearance,{animal:'fox',cart:'tico'});
 assert.ok(room.players.every(p=>!p.ready&&!p.airborne&&!p.spawn&&!p.v2HorizontalInput));
 setPlayerReady('a',true);setPlayerReady('b',true);assert.equal(game.startRoom('a').ok,true);
 assert.equal(room.arena.craters.length,0);assert.ok(room.players.every(p=>p.spawn&&p.alive&&p.hp===100));
}));
