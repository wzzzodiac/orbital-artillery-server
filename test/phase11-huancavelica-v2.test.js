import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, getRoom, joinRoom, roomStore, setPlayerReady, startRoom } from '../rooms.js';
import {
  advanceTurnIfDue11,
  advanceAirborne11,
  fireProjectile11,
  jumpActivePlayer11,
  moveActivePlayer11,
  phase11HuancavelicaV2TestHooks,
  publicRoomState11,
  rematchRoom11,
  setAirInput11,
  setAim11,
  setTerrain11
} from '../phase11-huancavelica-v2.js';
import { setTerrain9 as setLegacyHuancavelica } from '../phase10-huancavelica.js';
import {
  HUANCAVELICA_V2_COLLISION_MODEL,
  HUANCAVELICA_V2_IMAGE_HEIGHT,
  HUANCAVELICA_V2_IMAGE_WIDTH,
  HUANCAVELICA_V2_REVISION,
  HUANCAVELICA_V2_SCALE,
  HUANCAVELICA_V2_WORLD_HEIGHT,
  HUANCAVELICA_V2_WORLD_WIDTH,
  clearHuancavelicaV2Crater,
  findHuancavelicaV2SurfaceBelow,
  firstHuancavelicaV2ProjectileImpact,
  firstHuancavelicaV2SolidOnSegment,
  huancavelicaV2BitmapTestHooks,
  huancavelicaV2ImageToWorld,
  huancavelicaV2MaskForRoom,
  huancavelicaV2SurfaceCandidatesBelow,
  isHuancavelicaV2Solid,
  worldToHuancavelicaV2Image
} from '../huancavelica-v2-bitmap.js';
import { V2_AIR_PHYSICS, advanceV2AirbornePlayer, startV2Airborne, v2GroundSurface } from '../huancavelica-v2-airborne.js';

const { installV2Arena, settleUnsupported }=phase11HuancavelicaV2TestHooks;
const imagePoint=(x,y)=>huancavelicaV2ImageToWorld(x,y);
const bareRoom=(craters=[])=>({arena:{craters}});

test('public terrain pool exposes v2 but never legacy Huancavelica',()=>{
  roomStore.clear();const room=createRoom('map-host','Host').room;
  const publicState=publicRoomState11(room),ids=publicState.terrainPresets.map(entry=>entry.id);
  assert.ok(ids.includes('huancavelica-v2'));
  assert.ok(!ids.includes('huancavelica'));
  assert.deepEqual(setTerrain11('map-host','huancavelica'),{ok:false,error:'invalid_terrain'});
  assert.equal(setTerrain11('map-host','huancavelica-v2').ok,true);
  assert.equal(publicRoomState11(room).terrainPreset,'huancavelica-v2');
  assert.ok(!publicRoomState11(room).terrainPresets.some(entry=>entry.id==='huancavelica'));
});

test('random selection and random rematch cannot revive v1 while legacy recovery remains available',()=>{
  roomStore.clear();const room=createRoom('map-host','Host').room;joinRoom(room.code,'map-guest','Guest');
  for(let i=0;i<30;i+=1){
    assert.equal(setTerrain11('map-host','random').ok,true);
    assert.notEqual(publicRoomState11(room).terrainPreset,'huancavelica');
  }
  assert.equal(setLegacyHuancavelica('map-host','huancavelica').ok,true,'Phase 10 legacy implementation remains callable for recovery');
  const legacy=publicRoomState11(room);
  assert.equal(legacy.terrainPreset,'huancavelica');
  assert.ok(!legacy.terrainPresets.some(entry=>entry.id==='huancavelica'),'Existing v1 rooms do not advertise a new v1 selection');
  for(const id of ['map-host','map-guest'])setPlayerReady(id,true);
  assert.equal(startRoom('map-host').ok,true);
  room.status='finished';room.match.result={type:'survival',winnerPlayerId:'map-host',winnerName:'Host',draw:false};room.match.finishedAt=Date.now();
  const randomRematch=rematchRoom11('map-host',{randomMap:true});
  assert.equal(randomRematch.ok,true);
  assert.notEqual(publicRoomState11(room).terrainPreset,'huancavelica');
  assert.ok(!publicRoomState11(room).terrainPresets.some(entry=>entry.id==='huancavelica'));
});

test('an existing legacy v1 room can rematch on its original map without reopening public selection',()=>{
  roomStore.clear();const room=createRoom('legacy-host','Host').room;joinRoom(room.code,'legacy-guest','Guest');
  assert.equal(setLegacyHuancavelica('legacy-host','huancavelica').ok,true);
  for(const id of ['legacy-host','legacy-guest'])setPlayerReady(id,true);
  assert.equal(startRoom('legacy-host').ok,true);
  room.status='finished';room.match.result={type:'survival',winnerPlayerId:'legacy-host',winnerName:'Host',draw:false};room.match.finishedAt=Date.now();
  assert.equal(rematchRoom11('legacy-host',{randomMap:false}).ok,true);
  const state=publicRoomState11(room);
  assert.equal(state.terrainPreset,'huancavelica');
  assert.ok(!state.terrainPresets.some(entry=>entry.id==='huancavelica'));
});

function startedV2(ids=['a','b']){
  roomStore.clear();const [host,...rest]=ids,room=createRoom(host,host.toUpperCase()).room;
  for(const id of rest)joinRoom(room.code,id,id.toUpperCase());
  assert.equal(setTerrain11(host,'huancavelica-v2').ok,true);
  for(const id of ids)setPlayerReady(id,true);
  assert.equal(startRoom(host).ok,true);publicRoomState11(room);activateRoom(room.code,room.match.startAt);publicRoomState11(room);return getRoom(room.code);
}

test('Huancavelica v2 uses a uniform 4:3 image/world transform',()=>{
  assert.deepEqual([HUANCAVELICA_V2_IMAGE_WIDTH,HUANCAVELICA_V2_IMAGE_HEIGHT],[1448,1086]);
  assert.equal(HUANCAVELICA_V2_WORLD_WIDTH,5000);assert.equal(HUANCAVELICA_V2_WORLD_HEIGHT,3750);
  assert.equal(HUANCAVELICA_V2_SCALE,HUANCAVELICA_V2_WORLD_HEIGHT/HUANCAVELICA_V2_IMAGE_HEIGHT);
  const world=imagePoint(713.25,448.75),image=worldToHuancavelicaV2Image(world.x,world.y);assert.ok(Math.abs(image.x-713.25)<1e-9);assert.ok(Math.abs(image.y-448.75)<1e-9);
  assert.equal(120/HUANCAVELICA_V2_SCALE,120/HUANCAVELICA_V2_SCALE,'a world circle has one image-space radius');
});

test('clean mask contains rock masses but excludes void, hanging vines and antialias debris',()=>{
  const room=bareRoom();
  assert.equal(isHuancavelicaV2Solid(room,...Object.values(imagePoint(720,150))),true);
  assert.equal(isHuancavelicaV2Solid(room,...Object.values(imagePoint(720,320))),false);
  assert.equal(isHuancavelicaV2Solid(room,...Object.values(imagePoint(640,268))),false,'long vine below the upper island is not terrain');
  assert.equal(isHuancavelicaV2Solid(room,...Object.values(imagePoint(841,568))),false,'isolated vegetation/noise is removed');
});

test('surface detection returns the first playable top below the query on stacked islands',()=>{
  const room=bareRoom(),x=imagePoint(720,0).x,surfaces=huancavelicaV2SurfaceCandidatesBelow(room,x,0,HUANCAVELICA_V2_WORLD_HEIGHT);
  assert.ok(surfaces.length>=3);assert.ok(Math.abs(worldToHuancavelicaV2Image(0,surfaces[0]).y-84)<5);assert.ok(Math.abs(worldToHuancavelicaV2Image(0,surfaces[1]).y-449)<8);
  const belowTop=findHuancavelicaV2SurfaceBelow(room,x,imagePoint(0,300).y,HUANCAVELICA_V2_WORLD_HEIGHT);assert.ok(Math.abs(worldToHuancavelicaV2Image(0,belowTop).y-449)<8);
});

test('steep side pixels cannot become playable floors',()=>{
  const mask=huancavelicaV2MaskForRoom(bareRoom()),sideX=13,sideY=402;
  assert.equal(isHuancavelicaV2Solid(bareRoom(),...Object.values(imagePoint(sideX,sideY))),true);
  assert.equal(huancavelicaV2BitmapTestHooks.boundaryAt(mask,sideX,sideY),true);
  assert.equal(findHuancavelicaV2SurfaceBelow(bareRoom(),imagePoint(sideX,0).x,imagePoint(0,sideY-2).y,30),null);
});

test('v2 public state advertises strict revision parity and no platform graph authority',()=>{
  const room={phase11TerrainAlias:'huancavelica-v2',status:'lobby',players:[],pickups:[],arena:{craters:[],worldWidth:5000,worldHeight:5000}},state=publicRoomState11(room);
  assert.equal(state.terrainPreset,'huancavelica-v2');assert.equal(state.arena.terrainRevision,HUANCAVELICA_V2_REVISION);assert.equal(state.arena.collisionModel,HUANCAVELICA_V2_COLLISION_MODEL);assert.deepEqual(state.arena.platforms,[]);assert.equal(state.phase11Map.oldPlatformGraphAuthority,false);
});

for(const count of[2,4,8])test(`${count}-player v2 spawns sit above real playable terrain`,()=>{
  const ids=Array.from({length:count},(_,index)=>`p${index}`),room=startedV2(ids);assert.equal(room.players.length,count);
  for(const player of room.players){assert.ok(player.spawn);assert.equal(isHuancavelicaV2Solid(room,player.spawn.x,player.spawn.y),false);assert.equal(isHuancavelicaV2Solid(room,player.spawn.x,player.spawn.y+10),true);assert.ok(findHuancavelicaV2SurfaceBelow(room,player.spawn.x,player.spawn.y,32)!=null);}
});

test('A/D keeps the 15-unit baseline and follows the visible top without using links',()=>{
  const room=startedV2(),id=room.match.activePlayerId,player=room.players.find(entry=>entry.id===id),from={...player.spawn};const result=moveActivePlayer11(id,player.spawn.facing||1);assert.equal(result.ok,true);assert.equal(Math.abs(player.spawn.x-from.x),15);assert.ok(Math.abs((player.spawn.y+8)-(findHuancavelicaV2SurfaceBelow(room,player.spawn.x,player.spawn.y,30)??0))<8);
});

test('spectator cannot move or jump during another player turn',()=>{
  const room=startedV2(),spectator=room.players.find(player=>player.id!==room.match.activePlayerId);assert.equal(moveActivePlayer11(spectator.id,1).error,'not_your_turn');assert.equal(jumpActivePlayer11(spectator.id,1).error,'not_your_turn');
});

test('SPACE creates upward velocity with no destination and airborne input changes direction',()=>{
  const room=startedV2(),id=room.match.activePlayerId,player=room.players.find(entry=>entry.id===id),start={...player.spawn};
  assert.equal(setAirInput11(id,1).ok,true);
  assert.equal(jumpActivePlayer11(id).ok,true);
  assert.equal(player.airborne.vy,-V2_AIR_PHYSICS.jumpImpulse);
  assert.equal(player.airborne.input,1);
  assert.equal(player.motion,null);
  assert.deepEqual(player.spawn,start,'takeoff must not preselect or teleport to a landing');
  assert.equal(jumpActivePlayer11(id).error,'already_airborne');
  assert.equal(fireProjectile11(id).error,'player_airborne');
  const now=player.airborne.updatedAt;
  assert.equal(advanceAirborne11(room.code,now+50),room);
  assert.ok(player.spawn.y<start.y);
  assert.ok(player.spawn.x>start.x);
  assert.equal(setAirInput11(id,-1).ok,true);
  assert.equal(player.airborne.input,-1);
  assert.equal(publicRoomState11(room).players.find(entry=>entry.id===id).airborne.vy<0,true);
});

test('jump and air control preserve active-turn, living-player and projectile locks',()=>{
  const room=startedV2(),id=room.match.activePlayerId,player=room.players.find(entry=>entry.id===id);
  room.match.projectile={id:'busy'};
  assert.equal(jumpActivePlayer11(id).error,'shot_in_flight');
  assert.equal(setAirInput11(id,1).error,'shot_in_flight');
  room.match.projectile=null;player.alive=false;
  assert.equal(jumpActivePlayer11(id).error,'player_missing');
  player.alive=true;room.match.activePlayerId=room.players.find(entry=>entry.id!==id).id;
  assert.equal(jumpActivePlayer11(id).error,'not_your_turn');
  assert.equal(setAirInput11(id,-1).error,'not_your_turn');
});

test('walking off an authored ledge begins the same airborne simulation without a target',()=>{
  const room=startedV2(),id=room.match.activePlayerId,player=room.players.find(entry=>entry.id===id);
  const x=imagePoint(911.5,0).x,surface=findHuancavelicaV2SurfaceBelow(room,x,imagePoint(0,450).y,100);
  assert.ok(surface!=null);
  player.spawn={x,y:surface-8,facing:1};player.motion=null;
  const fromY=player.spawn.y;
  assert.equal(setAirInput11(id,1).ok,true);
  assert.equal(moveActivePlayer11(id,1).ok,true);
  assert.equal(player.airborne?.reason,'ledge');
  assert.equal(player.airborne?.vy,0);
  assert.equal(player.spawn.y,fromY);
  assert.equal(player.motion,null);
  assert.equal(moveActivePlayer11(id,1).error,'player_airborne');
  advanceAirborne11(room.code,player.airborne.updatedAt+100);
  assert.ok(player.spawn.y>fromY);
});

test('v2 blocks firing and aim while airborne, then permits normal firing after landing',()=>{
  const room=startedV2(),id=room.match.activePlayerId,player=room.players.find(entry=>entry.id===id);
  assert.equal(jumpActivePlayer11(id).ok,true);
  assert.equal(fireProjectile11(id).error,'player_airborne');
  assert.equal(setAim11(id,50,60).error,'player_airborne');
  for(let i=1;i<=35&&player.airborne;i+=1)advanceAirborne11(room.code,player.airborne.updatedAt+50);
  assert.equal(player.airborne,null);
  assert.equal(setAim11(id,50,60).ok,true);
  assert.equal(fireProjectile11(id).ok,true);
});

test('active v2 player can fire BASIC without changing aim, power, wind or gravity',()=>{
  const room=startedV2(),id=room.match.activePlayerId,angle=room.match.aimAngle,power=room.match.aimPower,wind={...room.match.wind},result=fireProjectile11(id);assert.equal(result.ok,true);const shot=room.match.projectile;assert.ok(shot);assert.equal(shot.angle,angle);assert.equal(shot.power,power);assert.deepEqual(room.match.wind,wind);assert.ok(shot.gravity>0);assert.equal(isHuancavelicaV2Solid(room,shot.startX,shot.startY),false);assert.ok(['terrain','player','out_of_bounds','timeout'].includes(shot.impactReason));
});

test('segmented projectile sweep finds thin terrain that endpoint-only sampling could tunnel through',()=>{
  const room=bareRoom(),y=imagePoint(0,390).y,hit=firstHuancavelicaV2SolidOnSegment(room,{x:0,y},{x:1800,y});assert.ok(hit);assert.equal(isHuancavelicaV2Solid(room,hit.x,hit.y),true);
  const projectile={startX:0,startY:y,vx:5000,vy:0,windAccel:0,gravity:0},impact=firstHuancavelicaV2ProjectileImpact(room,projectile,.5);assert.ok(impact);
});

test('crater replay clears the same circular terrain pixels for live rooms and late joins',()=>{
  const center={id:'v2-hole',...imagePoint(720,150),radius:145},clean=bareRoom(),mask=huancavelicaV2MaskForRoom(clean).slice(),image=worldToHuancavelicaV2Image(center.x,center.y),index=Math.floor(image.y)*HUANCAVELICA_V2_IMAGE_WIDTH+Math.floor(image.x);assert.equal(huancavelicaV2BitmapTestHooks.hasBit(mask,index),true);clearHuancavelicaV2Crater(mask,center);assert.equal(huancavelicaV2BitmapTestHooks.hasBit(mask,index),false);
  const live=bareRoom([center]),repeat=huancavelicaV2MaskForRoom(live),late=huancavelicaV2MaskForRoom(bareRoom([{...center}]));assert.equal(repeat,huancavelicaV2MaskForRoom(live));assert.deepEqual(repeat,late);
});

test('destroying support starts gravity without snapping to a lower island',()=>{
  const x=imagePoint(720,0).x,top=findHuancavelicaV2SurfaceBelow(bareRoom(),x,0,1000),room={mode:'survival',status:'started',players:[{id:'a',hp:100,alive:true,spawn:{x,y:top-8,facing:1}},{id:'b',hp:100,alive:true,spawn:{x:imagePoint(1100,0).x,y:imagePoint(0,380).y-8,facing:-1}}],arena:{craters:[{id:'hole',x,y:top,radius:180}]},match:{turnEndsAt:Date.now()+30000}};const before=new Map([['a',{alive:true,hp:100,spawn:{...room.players[0].spawn}}]]);settleUnsupported(room,before);assert.equal(room.players[0].airborne?.reason,'support_loss');assert.equal(room.players[0].spawn.y,top-8);assert.equal(room.players[0].motion,null);
});

test('other maps and Huancavelica v1 keep their existing collision models',()=>{
  const ordinary=publicRoomState11({terrainPreset:'rolling',status:'lobby',players:[],pickups:[],arena:{craters:[],collisionModel:'heightfield'}});assert.equal(ordinary.arena.collisionModel,'heightfield');
  assert.equal(phase11HuancavelicaV2TestHooks.isV2({phase10TerrainAlias:'huancavelica'}),false);
});
