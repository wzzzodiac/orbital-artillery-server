import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,setPlayerReady,startRoom,activateRoom,roomStore} from '../rooms.js';
import {setTerrain9,setAirInput11,jumpActivePlayer9,advanceTurnIfDue9,fireProjectile9,setAim9,publicRoomState9} from '../phase11-huancavelica-v2.js';
import {findHuancavelicaV2SurfaceBelow,HUANCAVELICA_V2_SCALE as scale,isHuancavelicaV2Solid} from '../huancavelica-v2-bitmap.js';
import {V2_AIR_PHYSICS} from '../huancavelica-v2-airborne.js';
import {traceFlight} from '../simulation/collision.js';
function fixture(run){const old=Date.now;let now=1800000000000;Date.now=()=>now;roomStore.clear();try{
  const r=createRoom('a','A').room;joinRoom(r.code,'b','B');setTerrain9('a','huancavelica-v2');setPlayerReady('a',true);setPlayerReady('b',true);startRoom('a');now=r.match.startAt;activateRoom(r.code,now);r.match.activePlayerId='b';r.match.turnIndex=r.match.turnOrder.indexOf('b');
  run(r,r.players[1],()=>now,ms=>{now+=ms;advanceTurnIfDue9(r.code,now);});
}finally{Date.now=old;roomStore.clear();}}
const routes=[
 ['main-left upper-left',281,379,1,1,0,100,335,514,247],
 ['upper-right crown',1118,250,-1,-1,0,900,580,860,89],
 ['main-right upper-right',1161,380,-1,0,300,300,938,1144,247],
 ['upper-left peak-step',472,247,1,0,300,100,488,580,145],
 ['peak-step crown',534,145,1,0,0,200,580,860,89],
 ['lower-left middle-left',500,735,-1,1,300,300,346,516,532],
 ['middle-left centre',420,532,1,0,0,300,520,918,449],
 ['centre lower-step',710,449,-1,0,0,100,580,677,350],
 ['lower-step upper-step',660,350,-1,0,0,100,535,631,300],
 ['upper-step upper-left',550,300,-1,0,0,200,335,514,247]
];
for(const [name,sx,sy,dir,initial,delay,hold,minX,maxX,targetY]of routes)test(`G12 final runtime route ${name}`,()=>fixture((r,p,clock,tick)=>{
  const x=sx*scale,surface=findHuancavelicaV2SurfaceBelow(r,x,sy*scale-30);p.spawn={x,y:surface-8,facing:dir};
  assert.equal(setAirInput11('b',initial).ok,true);const from={...p.spawn};assert.equal(jumpActivePlayer9('b').ok,true);assert.deepEqual(p.spawn,from);let input=initial;
  for(let elapsed=20;elapsed<=4800&&p.airborne;elapsed+=20){
    const desired=elapsed<delay?initial:elapsed<delay+hold?dir:0;
    if(input!==desired){assert.equal(setAirInput11('b',desired).ok,true);input=desired;}
    tick(20);
  }
  assert.equal(p.alive,true);assert.equal(p.airborne,null,'bounded actual landing');
  const imageX=p.spawn.x/scale,imageY=(p.spawn.y+8)/scale;
  assert.ok(imageX>=minX-5&&imageX<=maxX+5,`actualX=${imageX}`);assert.ok(Math.abs(imageY-targetY)<12,`actualY=${imageY}`);
  assert.equal(r.match.activePlayerId,'b');assert.equal(r.match.result,null);
  const landed={...p.spawn};tick(50);assert.equal(p.airborne,null,'partial-edge landing remains supported on the next tick');assert.deepEqual(p.spawn,landed);
}));
for(const hold of [200,300,400,500,600])test(`G12 main-left ascent accepts ${hold}ms steering after clearing the underside`,()=>fixture((r,p,clock,tick)=>{
  const x=281*scale;p.spawn={x,y:findHuancavelicaV2SurfaceBelow(r,x,379*scale-30)-8,facing:1};
  jumpActivePlayer9('b');
  for(let elapsed=20;elapsed<=4800&&p.airborne;elapsed+=20){setAirInput11('b',elapsed>=700&&elapsed<700+hold?1:0);tick(20);}
  assert.equal(p.airborne,null);assert.ok((p.spawn.y+8)/scale<260);assert.equal(p.alive,true);
}));

test('G06 final runtime airborne authority, read purity and timeout settle once',()=>fixture((r,p,clock,tick)=>{
  assert.equal(jumpActivePlayer9('b').ok,true);
  assert.equal(jumpActivePlayer9('b').error,'already_airborne');assert.equal(fireProjectile9('b').error,'player_airborne');assert.equal(setAim9('b',60,70).error,'player_airborne');
  assert.equal(setAirInput11('a',1).error,'not_your_turn');
  assert.equal(setAirInput11('b',NaN).error,'invalid_direction');
  assert.equal(setAirInput11('b',1).ok,true);tick(50);assert.ok(p.airborne.vx>0);
  const before=structuredClone(r),view=publicRoomState9(r);assert.deepEqual(r,before);assert.notEqual(view.players[1].airborne,p.airborne);
  r.match.turnEndsAt=clock()+50;const turn=r.match.turnNumber;tick(100);
  assert.equal(r.match.turnNumber,turn,'timeout never abandons an airborne pose');assert.equal(p.airborne.input,0);
  for(let i=0;i<150&&r.match.turnNumber===turn&&r.status==='started';i++)tick(50);
  assert.ok(r.match.turnNumber===turn+1||r.status==='finished');assert.equal(p.v2HorizontalInput,0);
}));
test('G06 final runtime support-loss and physical void produce a single definitive death',()=>fixture((r,p,clock,tick)=>{
  p.spawn={x:20,y:3600,facing:1};const start=p.spawn.y;tick(50);
  assert.ok(p.airborne);assert.equal(p.hp,100);assert.equal(p.alive,true);assert.equal(p.spawn.y,start,'support loss does not teleport or kill');
  for(let i=0;i<120&&p.alive;i++)tick(50);
  assert.equal(p.alive,false);assert.equal(p.hp,0);assert.ok(p.spawn.y+V2_AIR_PHYSICS.bodyTop>V2_AIR_PHYSICS.voidBoundary);
  const stats=publicRoomState9(r).matchStats.find(s=>s.playerId==='b');assert.equal(stats.deaths,1);
  const after=structuredClone(r);tick(50);assert.deepEqual(r,after,'finished match cannot resolve void twice');
}));
test('owner initial grace stays tied to launch pose after movement and cannot hit before departure',()=>{
  const shot={startX:0,startY:0,vx:100,vy:0,gravity:0,ownerLaunchSpawn:{x:0,y:10}};
  const hit=traceFlight(shot,{players:[{id:'owner',alive:true,spawn:{x:100,y:10}}],ownerId:'owner',firstSolid:()=>null});
  assert.equal(hit.type,'player');assert.ok(hit.seconds>=.52&&hit.seconds<.541);
});
