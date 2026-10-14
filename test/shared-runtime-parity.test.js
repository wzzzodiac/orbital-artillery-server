import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,setPlayerReady,startRoom,activateRoom,roomStore} from '../rooms.js';
import {setTerrain9,fireProjectile9,advanceTurnIfDue9,jumpActivePlayer9,setAirInput11} from '../phase11-huancavelica-v2.js';
import {huancavelicaV2BitmapTestHooks as hooks,findHuancavelicaV2SurfaceBelow,HUANCAVELICA_V2_SCALE as scale} from '../huancavelica-v2-bitmap.js';
import {createGameplayCore} from '../simulation/core.js';
import {canonical} from './core-scenario.js';
for(const weapon of ['basic','heavy','triple','cluster','airstrike','nuke'])test(`G08 final Node adapter vs browser core command/tick parity: ${weapon}`,()=>{
 const original=Date.now;let now=1800000000000;Date.now=()=>now;roomStore.clear();
 try{
  const room=createRoom('a','A').room;joinRoom(room.code,'b','B');setTerrain9('a','huancavelica-v2');setPlayerReady('a',true);setPlayerReady('b',true);startRoom('a');now=room.match.startAt;activateRoom(room.code,now);
  room.match.activePlayerId='b';room.match.turnIndex=room.match.turnOrder.indexOf('b');room.match.wind={signed:0};room.match.aimAngle=5;room.match.aimPower=10;room.pickups=[];
  for(const [id,ix]of[['b',100],['a',150]]){const p=room.players.find(p=>p.id===id),x=ix*scale;p.spawn={x,y:findHuancavelicaV2SurfaceBelow(room,x,379*scale-30)-8,facing:1};p.inventory=[null,null];p.selectedItemSlot=1;}
  const actor=room.players.find(p=>p.id==='b');if(weapon!=='basic'){actor.inventory[0]={type:weapon,label:weapon};actor.selectedItemSlot=2;}
  const copy=structuredClone(room),core=createGameplayCore(hooks.CLEAN_MASK);
  assert.equal(core.command(copy,'b','fire_projectile',{},now).ok,true);assert.equal(fireProjectile9('b').ok,true);
  const a=room.match.projectile,b=copy.match.projectile;
  const contact=q=>canonical({x:q.impactX,y:q.impactY,at:q.impactAt,reason:q.impactReason,hit:q.hitPlayerId});assert.deepEqual(contact(a),contact(b));
  for(let i=0;i<1700&&(room.match.projectile||copy.match.projectile);i++){now+=20;advanceTurnIfDue9(room.code,now);core.tick(copy,now);}
  const players=r=>canonical(r.players.map(p=>({id:p.id,hp:p.hp,alive:p.alive,spawn:p.spawn,airborne:p.airborne,inventory:p.inventory})));assert.deepEqual(players(room),players(copy));
  const cuts=r=>canonical(r.arena.craters.map(c=>({x:c.x,y:c.y,radius:c.radius,depth:c.depth,at:c.createdAt})));assert.deepEqual(cuts(room),cuts(copy));assert.equal(room.match.projectile,null);assert.equal(copy.match.projectile,null);
 }finally{Date.now=original;roomStore.clear();}
});

test('G08 final Node adapter vs browser movement commands and ticks',()=>{
 const original=Date.now;let now=1800000000000;Date.now=()=>now;roomStore.clear();
 try{
  const room=createRoom('a','A').room;joinRoom(room.code,'b','B');setTerrain9('a','huancavelica-v2');setPlayerReady('a',true);setPlayerReady('b',true);startRoom('a');now=room.match.startAt;activateRoom(room.code,now);room.match.activePlayerId='b';room.match.turnIndex=room.match.turnOrder.indexOf('b');room.pickups=[];
  const p=room.players[1],x=281*scale;p.spawn={x,y:findHuancavelicaV2SurfaceBelow(room,x,379*scale-30)-8,facing:1};
  const copy=structuredClone(room),core=createGameplayCore(hooks.CLEAN_MASK);assert.equal(jumpActivePlayer9('b').ok,true);assert.equal(core.command(copy,'b','jump_player',{},now).ok,true);
  for(let i=1;i<=200;i++){now+=20;if([35,55,65].includes(i)){const direction=i===35?1:i===55?-1:0;setAirInput11('b',direction);core.command(copy,'b','air_input',{direction},now);}advanceTurnIfDue9(room.code,now);core.tick(copy,now);assert.deepEqual(canonical(p.spawn),canonical(copy.players[1].spawn));assert.deepEqual(canonical(p.airborne),canonical(copy.players[1].airborne));}
 }finally{Date.now=original;roomStore.clear();}
});
