import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRoom,joinRoom,setPlayerReady,activateRoom,roomStore} from '../rooms.js';
import * as game from '../phase12-themed-maps.js';
import {themedTerrains,THEMED_BITMAP_MAPS} from '../themed-bitmap.js';
import {createPracticeSession} from '../simulation/practice.js';
const realNow=Date.now;let clock=1_800_000_000_000;
function run(fn){Date.now=()=>clock;roomStore.clear();clock+=100000;try{fn();}finally{Date.now=realNow;roomStore.clear();}}
function started(id){
 const room=createRoom('a','A').room;joinRoom(room.code,'b','B');assert.equal(game.setTerrain9('a',id).ok,true);
 setPlayerReady('a',true);setPlayerReady('b',true);assert.equal(game.startRoom('a').ok,true);clock=room.match.startAt;activateRoom(room.code,clock);
 room.match.wind={signed:0,strength:0,direction:'none'};return room;
}
for(const id of ['rolling','brokenridge']){
 test(id+' production bitmap: spawn, authority, airborne input, read-only serialization and rematch',()=>run(()=>{
  const room=started(id),terrain=themedTerrains[id];
  for(const p of room.players){assert.ok(terrain.isHuancavelicaV2Solid(room,p.spawn.x,p.spawn.y+12));assert.equal(terrain.isHuancavelicaV2Solid(room,p.spawn.x,p.spawn.y-30),false);}
  const before=structuredClone(room),state=game.publicRoomState9(room);assert.deepEqual(room,before);assert.equal(state.arena.bitmapTheme,id);assert.equal(state.arena.worldHeight,5000);
  const active=room.match.activePlayerId,p=room.players.find(p=>p.id===active),startY=p.spawn.y;
  assert.equal(game.setAirInput11(active,1).ok,true);assert.equal(game.jumpActivePlayer9(active).ok,true);
  assert.equal(game.jumpActivePlayer9(active).error,'already_airborne');assert.equal(game.fireProjectile9(active).error,'player_airborne');
  clock+=100;game.advanceTurnIfDue9(room.code,clock);assert.ok(p.spawn.y<startY);assert.ok(p.airborne);
  assert.ok(game.publicRoomState9(room).players.find(x=>x.id===active).airborne);
  room.status='finished';room.match.result={type:'team',winnerTeam:'A',draw:false};assert.equal(game.rematchRoom9('a',{randomMap:false}).ok,true);
  assert.equal(room.arena.bitmapTheme,id);assert.equal(room.arena.craters.length,0);assert.ok(room.players.every(p=>!p.airborne));
 }));
 test(id+' bitmap support loss affects inactive bodies; subsurface cuts retain a solid roof',()=>run(()=>{
  const room=started(id),terrain=themedTerrains[id],p=room.players.find(p=>p.id!==room.match.activePlayerId),feet=p.spawn.y+8;
  room.arena.craters.push({id:'tunnel',x:p.spawn.x,y:feet+300,radius:90});
  assert.equal(terrain.isHuancavelicaV2Solid(room,p.spawn.x,feet+300),false);assert.equal(terrain.isHuancavelicaV2Solid(room,p.spawn.x,feet+20),true);
  const prior=p.spawn.y;room.arena.craters.push({id:'support',x:p.spawn.x,y:feet+10,radius:130});
  game.advanceTurnIfDue9(room.code,clock);assert.ok(p.airborne);assert.equal(p.airborne.reason,'support_loss');clock+=100;game.advanceTurnIfDue9(room.code,clock);
  assert.ok(p.spawn.y>prior);assert.ok(p.alive,'a lost floor starts falling, not an instant death');
 }));
 for(const weapon of ['basic','heavy','triple','cluster','airstrike','nuke'])test(id+' composed '+weapon+' resolves against its own bitmap',()=>run(()=>{
  const room=started(id),active=room.match.activePlayerId,p=room.players.find(p=>p.id===active);
  if(weapon!=='basic'){p.inventory=[{type:weapon,label:weapon},null];assert.equal(game.selectItem9(active,2).ok,true);}
  assert.equal(game.setAim9(active,65,18).ok,true);assert.equal(game.fireProjectile9(active).ok,true);
  const q=room.match.projectile;assert.ok(q);
  for(let n=0;n<600&&room.match.projectile;n++){clock+=50;game.advanceTurnIfDue9(room.code,clock);}
  assert.equal(room.match.projectile,null,'bounded resolution');assert.ok(room.arena.craters.length>0,'real terrain cut');
  const terrain=themedTerrains[id],cut=room.arena.craters[0];assert.equal(terrain.isHuancavelicaV2Solid(room,cut.x,cut.y),false);
  assert.ok(room.players.every(p=>Number.isFinite(p.spawn.x)&&Number.isFinite(p.spawn.y)));
 }));
 test(id+' offline practice uses the same packed mask and supports reset after damage',()=>{
  const mask=new Uint8Array(readFileSync(new URL('../assets/'+THEMED_BITMAP_MAPS[id].folder+'-terrain-mask.bin',import.meta.url))),practice=createPracticeSession(mask,{mapId:id,profile:'reference-v1',now:0});
  const initial=practice.getState();assert.equal(initial.arena.bitmapTheme,id);assert.equal(initial.arena.worldHeight,5000);assert.ok(initial.players.every(p=>p.spawn));
  assert.equal(practice.command('jump_player',{},0).ok,true);for(let now=20;now<3000;now+=20)practice.tick(now);assert.equal(practice.getState().players[0].airborne,null);
  assert.equal(practice.equip('heavy',3000).ok,true);assert.equal(practice.command('set_aim',{angle:65,power:18},3000).ok,true);assert.equal(practice.command('fire_projectile',{},3000).ok,true);
  for(let now=3020;now<18000&&practice.getState().match.projectile;now+=20)practice.tick(now);
  assert.ok(practice.getState().arena.craters.length);practice.reset(18000);assert.deepEqual(practice.getState().players,initial.players);assert.equal(practice.getState().arena.craters.length,0);practice.dispose();
 });
}
test('quarry void extends to its5000-unit world floor and random rematches keep the correct mask',()=>run(()=>{
 const room=started('brokenridge'),p=room.players.find(p=>p.id!==room.match.activePlayerId);p.spawn={x:1070,y:3500,facing:1};p.motion=null;p.airborne=null;
 for(let i=0;i<150&&p.alive;i++){clock+=50;game.advanceTurnIfDue9(room.code,clock);if(p.spawn.y<4900)assert.ok(p.alive,'no Huancavelica3750 floor leak');}
 assert.equal(p.alive,false);assert.ok(p.spawn.y>5000);
 for(let i=0;i<12;i++){
  room.status='finished';room.match.result={type:'team',winnerTeam:'A',draw:false};assert.equal(game.rematchRoom9('a',{randomMap:true}).ok,true);
  const state=game.publicRoomState9(room),theme=THEMED_BITMAP_MAPS[state.terrainPreset];
  assert.equal(state.arena.worldHeight,theme?5000:3750);if(theme)assert.equal(state.arena.terrainRevision,theme.revision);
 }
}));
