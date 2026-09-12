import { findRoomBySocket, getRoom } from './rooms.js';
import {
  advanceTurnIfDue9 as baseAdvance,
  disconnectPlayer9,
  fireProjectile9 as baseFire,
  jumpActivePlayer9 as baseJump,
  moveActivePlayer9 as baseMove,
  phase10HuancavelicaTestHooks,
  phase9AirPickupTestHooks,
  phase9TestHooks,
  phase9TraversalTestHooks,
  publicRoomState9 as basePublic,
  rematchRoom9 as baseRematch,
  selectItem9,
  setAim9,
  setTerrain9 as baseSetTerrain
} from './phase10-huancavelica.js';
import {
  HUANCAVELICA_V2_COLLISION_MODEL,
  HUANCAVELICA_V2_ID,
  HUANCAVELICA_V2_IMAGE_HEIGHT,
  HUANCAVELICA_V2_IMAGE_WIDTH,
  HUANCAVELICA_V2_NAME,
  HUANCAVELICA_V2_REVISION,
  HUANCAVELICA_V2_SCALE,
  HUANCAVELICA_V2_WORLD_HEIGHT,
  HUANCAVELICA_V2_WORLD_WIDTH,
  findHuancavelicaV2SurfaceBelow,
  findHuancavelicaV2SurfaceNear,
  firstHuancavelicaV2ProjectileImpact,
  huancavelicaV2ImageToWorld,
  huancavelicaV2JumpPathClear,
  huancavelicaV2LandingHasRun,
  huancavelicaV2SurfaceCandidatesBelow,
  isHuancavelicaV2Solid
} from './huancavelica-v2-bitmap.js';

const COLLISION_BASE='islands';
const GROUND_OFFSET=8;
const WALK_STEP=15;
const MAX_WALK_SURFACE_DELTA=42;
const MOVE_VISUAL_MS=110;
const NORMAL_JUMP_DISTANCE=180;
const EXTENDED_MAX_DISTANCE=420;
const MAX_JUMP_RISE=1050;
const BASE_APEX=150;
const MAX_APEX=1050;
const FALL_MIN_MS=260;
const FALL_MAX_MS=1500;
const VOID_FINISH_BUFFER_MS=250;
const SPAWN_IMAGE_HINTS=Object.freeze([
  {x:281,y:379,label:'left-main'},
  {x:1161,y:380,label:'right-main'},
  {x:730,y:449,label:'center-main'},
  {x:472,y:247,label:'upper-left'},
  {x:1118,y:250,label:'upper-right'},
  {x:420,y:532,label:'middle-left'},
  {x:1020,y:532,label:'middle-right'},
  {x:730,y:786,label:'lower-center'}
]);

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const isV2=room=>room?.phase11TerrainAlias===HUANCAVELICA_V2_ID||room?.arena?.phase11Theme===HUANCAVELICA_V2_ID;
const feetY=player=>Number(player?.spawn?.y)+GROUND_OFFSET;

function resultFor(room){
  const alive=room.players.filter(player=>player.alive!==false);
  if(room.mode==='survival'){if(alive.length>1)return null;return{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:alive.length===0};}
  const teams=[...new Set(alive.map(player=>player.team))];if(teams.length>1)return null;return{type:'team',winnerTeam:teams[0]??null,draw:teams.length===0};
}

function validateAction(room,player,id){
  if(!room)return'not_in_room';if(room.status!=='started')return'match_not_started';if(room.match?.activePlayerId!==id)return'not_your_turn';if(room.match?.projectile)return'shot_in_flight';if(!player?.spawn||player.alive===false)return'player_missing';if(player.motion?.endsAt&&Date.now()<Number(player.motion.endsAt))return'player_in_motion';return null;
}

function spawnAtHint(room,hint,index){
  const world=huancavelicaV2ImageToWorld(hint.x,hint.y),surface=findHuancavelicaV2SurfaceNear(room,world.x,world.y,80,100)??findHuancavelicaV2SurfaceBelow(room,world.x,Math.max(0,world.y-100),220);
  if(surface==null)throw new Error(`Huancavelica v2 spawn hint ${hint.label} has no playable surface`);
  return{x:Math.round(world.x),y:Math.round(surface-GROUND_OFFSET),facing:index%2===0?1:-1};
}

function assignV2Spawns(room){
  const key=`${room.match?.countdownStartedAt??room.startedAt??'lobby'}:${room.players.length}`;
  if(room.phase11SpawnKey===key)return;
  room.players.forEach((player,index)=>{player.spawn=spawnAtHint(room,SPAWN_IMAGE_HINTS[index%SPAWN_IMAGE_HINTS.length],index);player.motion=null;player.phase11SpawnHint=SPAWN_IMAGE_HINTS[index%SPAWN_IMAGE_HINTS.length].label;});
  room.phase11SpawnKey=key;
}

function installV2Arena(room){
  if(!isV2(room)||!room?.arena)return room;
  Object.assign(room.arena,{terrainPreset:HUANCAVELICA_V2_ID,terrainName:HUANCAVELICA_V2_NAME,phase11Theme:HUANCAVELICA_V2_ID,terrainRevision:HUANCAVELICA_V2_REVISION,collisionModel:HUANCAVELICA_V2_COLLISION_MODEL,worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,voidFloor:true,platforms:[],legacyCollisionBase:COLLISION_BASE,bitmapTerrain:{width:HUANCAVELICA_V2_IMAGE_WIDTH,height:HUANCAVELICA_V2_IMAGE_HEIGHT,worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,uniformScale:HUANCAVELICA_V2_SCALE,maskSource:'cleaned-terrain-alpha-guided-by-supplied-mask'}});
  if(['countdown','started','finished'].includes(room.status))assignV2Spawns(room);
  snapPickups(room);
  return room;
}

function collectAfterMotion(room,player,id){phase9AirPickupTestHooks.collectOneAlongMotion?.(room,player,id);phase9TestHooks.collectOneByTouch?.(room,player);phase9TestHooks.maintainPhase9Pickups?.(room);snapPickups(room);}

function beginFall(room,player,from,toX,targetY,dir,type='fall',apex=0){
  const now=Date.now(),voidFall=targetY==null,toY=voidFall?HUANCAVELICA_V2_WORLD_HEIGHT+120:Math.round(targetY-GROUND_OFFSET),distance=Math.max(0,toY-from.y),duration=Math.round(clamp(distance*2.2,FALL_MIN_MS,FALL_MAX_MS));
  if(voidFall){player.hp=0;player.alive=false;room.match.pendingResult=resultFor(room);room.match.turnEndsAt=now+duration+VOID_FINISH_BUFFER_MS;room.camera={mode:'follow',targetPlayerId:player.id};}
  player.spawn={x:toX,y:toY,facing:dir};player.motion={type,startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX,toY,apex};return voidFall;
}

function moveOnV2(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(entry=>entry.id===id);installV2Arena(room);const error=validateAction(room,player,id);if(error)return{ok:false,error};
  const dir=Number(direction)<0?-1:Number(direction)>0?1:0;if(!dir)return{ok:false,error:'invalid_direction'};
  const from={...player.spawn},nextX=clamp(from.x+dir*WALK_STEP,40,HUANCAVELICA_V2_WORLD_WIDTH-40);if(Math.abs(nextX-from.x)<.01)return{ok:false,error:'movement_limit'};
  if(isHuancavelicaV2Solid(room,nextX,from.y-14))return{ok:false,error:'terrain_too_steep'};
  const current=feetY(player),near=findHuancavelicaV2SurfaceNear(room,nextX,current,MAX_WALK_SURFACE_DELTA,MAX_WALK_SURFACE_DELTA);
  if(near!=null&&Math.abs(near-current)<=MAX_WALK_SURFACE_DELTA){const now=Date.now(),toY=Math.round(near-GROUND_OFFSET);player.spawn={x:nextX,y:toY,facing:dir};player.motion={type:'move',startedAt:now,endsAt:now+MOVE_VISUAL_MS,fromX:from.x,fromY:from.y,toX:nextX,toY,apex:0};collectAfterMotion(room,player,id);return{ok:true,room};}
  const lower=findHuancavelicaV2SurfaceBelow(room,nextX,current+3,HUANCAVELICA_V2_WORLD_HEIGHT-current);beginFall(room,player,from,nextX,lower,dir);collectAfterMotion(room,player,id);return{ok:true,room,naturalDrop:true};
}

function requiredApex(room,from,to){
  const delta=Math.abs(to.y-from.y);return Math.ceil(Math.max(BASE_APEX,from.y-to.y+100,delta*.72+150));
}

function landingAt(room,from,dir,distance){
  const x=clamp(from.x+dir*distance,40,HUANCAVELICA_V2_WORLD_WIDTH-40),start=Math.max(0,from.y-MAX_JUMP_RISE),surfaces=huancavelicaV2SurfaceCandidatesBelow(room,x,start,MAX_JUMP_RISE*2+400);
  for(const surface of surfaces){const y=Math.round(surface-GROUND_OFFSET),rise=from.y-y;if(rise>MAX_JUMP_RISE||!huancavelicaV2LandingHasRun(room,x,surface))continue;const to={x,y},apex=requiredApex(room,from,to);if(apex<=MAX_APEX&&huancavelicaV2JumpPathClear(room,from,to,apex))return{...to,apex,distance};}
  return null;
}

function jumpOnV2(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(entry=>entry.id===id);installV2Arena(room);const error=validateAction(room,player,id);if(error)return{ok:false,error};
  const now=Date.now();if(player.lastFreeJumpAt&&now-player.lastFreeJumpAt<180)return{ok:false,error:'jump_cooldown'};
  const dir=Number(direction)<0?-1:Number(direction)>0?1:(player.spawn.facing||1),from={...player.spawn};let landing=landingAt(room,from,dir,NORMAL_JUMP_DISTANCE);
  if(!landing)for(let distance=210;distance<=EXTENDED_MAX_DISTANCE&&!landing;distance+=15)landing=landingAt(room,from,dir,distance);
  player.lastFreeJumpAt=now;
  if(!landing){const toX=clamp(from.x+dir*NORMAL_JUMP_DISTANCE,40,HUANCAVELICA_V2_WORLD_WIDTH-40),lower=findHuancavelicaV2SurfaceBelow(room,toX,feetY(player)+3,HUANCAVELICA_V2_WORLD_HEIGHT-feetY(player));beginFall(room,player,from,toX,lower,dir,'jump',BASE_APEX);collectAfterMotion(room,player,id);return{ok:true,room,voidJump:lower==null};}
  const duration=Math.round(clamp(520+(landing.distance-NORMAL_JUMP_DISTANCE)*1.1,520,820));player.spawn={x:landing.x,y:landing.y,facing:dir};player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:landing.x,toY:landing.y,apex:landing.apex,bitmapTerrainJump:true};collectAfterMotion(room,player,id);return{ok:true,room,bitmapTerrainJump:true};
}

function ensureMuzzleOutside(room,shot){
  if(!shot)return false;let x=Number(shot.startX),y=Number(shot.startY);if(!isHuancavelicaV2Solid(room,x,y))return false;const length=Math.max(1,Math.hypot(Number(shot.vx??0),Number(shot.vy??0))),dx=Number(shot.vx??0)/length,dy=Number(shot.vy??0)/length;
  for(let distance=4;distance<=96;distance+=4){const nx=x+dx*distance,ny=y+dy*distance;if(!isHuancavelicaV2Solid(room,nx,ny)){shot.startX=nx;shot.startY=ny;return true;}}
  return false;
}

function applyImpact(shot,impact){
  if(!shot||!impact)return false;const candidateAt=Number(shot.startedAt)+Math.round(impact.t*1000);if(shot.impactReason==='player'&&Number(shot.impactAt)<=candidateAt)return false;shot.impactReason='terrain';shot.hitPlayerId=null;shot.impactX=impact.x;shot.impactY=impact.y;shot.durationMs=Math.max(220,Math.round(impact.t*1000));shot.impactAt=Number(shot.startedAt)+shot.durationMs;return true;
}

function adjustProjectile(room,q){
  if(!q)return false;let changed=false;
  if(q.weaponType==='airstrike'){for(const shell of q.airStrikeShells??[]){const surface=findHuancavelicaV2SurfaceBelow(room,Number(shell.x),0,HUANCAVELICA_V2_WORLD_HEIGHT);if(surface!=null){shell.y=surface;changed=true;}}return changed;}
  const shots=q.weaponType==='triple'&&Array.isArray(q.volley)?q.volley:[q];for(const shot of shots){ensureMuzzleOutside(room,shot);const impact=firstHuancavelicaV2ProjectileImpact(room,shot);if(impact)changed=applyImpact(shot,impact)||changed;}
  if(q.weaponType==='triple'){q.specialResolveAt=Math.max(...q.volley.map(shot=>Number(shot.impactAt??0)));q.resolveAt=q.specialResolveAt+900;return changed;}
  if(q.weaponType==='cluster'){q.clusterImpacts=(q.clusterImpacts??[]).map((child,index)=>{const x=clamp(Number(child.x),0,HUANCAVELICA_V2_WORLD_WIDTH),surface=findHuancavelicaV2SurfaceBelow(room,x,0,HUANCAVELICA_V2_WORLD_HEIGHT);return{...child,x,y:surface??HUANCAVELICA_V2_WORLD_HEIGHT,visualStartAt:q.impactAt+667+index*167,impactAt:q.impactAt+667+index*167+1333};});q.specialResolveAt=Math.max(q.impactAt,...q.clusterImpacts.map(entry=>entry.impactAt));q.resolveAt=q.specialResolveAt+900;}
  else if(q.weaponType==='nuke'&&changed){q.targetX=q.impactX;q.targetY=q.impactY;if(q.nukeBeam)q.nukeBeam={...q.nukeBeam,bx:q.impactX,by:q.impactY};q.targetLockedAt=q.impactAt;q.warningUntil=q.impactAt+5000;q.beamAt=q.warningUntil;q.beamUntil=q.beamAt+5000;q.resolveAt=q.beamUntil+1500;}
  else if(changed)q.resolveAt=Math.max(Number(q.resolveAt??0),q.impactAt+900);return changed;
}

function projectileCraterHints(q){
  if(!q)return[];const entries=[q,...(q.volley??[]),...(q.clusterImpacts??[]),...(q.airStrikeShells??[])];return entries.map(entry=>({x:Number(entry.x??entry.impactX),y:Number(entry.y??entry.impactY)})).filter(entry=>Number.isFinite(entry.x)&&Number.isFinite(entry.y));
}
function bindNewCraters(room,knownIds,hints){for(const crater of room?.arena?.craters??[]){if(knownIds.has(crater.id)&&Number.isFinite(Number(crater.y)))continue;const nearest=[...hints].sort((a,b)=>Math.abs(a.x-Number(crater.x))-Math.abs(b.x-Number(crater.x)))[0];if(nearest)crater.y=Math.round(nearest.y);else{const surface=findHuancavelicaV2SurfaceBelow(room,Number(crater.x),0,HUANCAVELICA_V2_WORLD_HEIGHT);if(surface!=null)crater.y=Math.round(surface);}}}

function settleUnsupported(room,before=new Map()){
  const now=Date.now();for(const player of room.players??[]){const old=before.get(player.id);if(old?.alive!==false&&player.alive===false&&player.lastDamage?.at===old.lastDamageAt){player.alive=true;player.hp=old.hp;player.spawn={...old.spawn};}if(player.alive===false||!player.spawn)continue;const startY=Math.min(Number(player.spawn.y),Number(old?.spawn?.y??player.spawn.y))+GROUND_OFFSET+2,surface=findHuancavelicaV2SurfaceBelow(room,player.spawn.x,startY,HUANCAVELICA_V2_WORLD_HEIGHT-startY);if(surface==null){beginFall(room,player,{...player.spawn},player.spawn.x,null,player.spawn.facing||1);continue;}const targetY=Math.round(surface-GROUND_OFFSET);if(targetY<=player.spawn.y+2)continue;const from={...player.spawn},duration=Math.round(clamp((targetY-from.y)*2.2,FALL_MIN_MS,FALL_MAX_MS));player.spawn={...player.spawn,y:targetY};player.motion={type:'fall',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:from.x,toY:targetY,apex:0,bitmapSupportLost:true};}
}

function safePickupSurface(room,x,y=0){const direct=findHuancavelicaV2SurfaceBelow(room,x,Math.max(0,y),HUANCAVELICA_V2_WORLD_HEIGHT-y);if(direct!=null&&huancavelicaV2LandingHasRun(room,x,direct,18,85))return{x,surface:direct};for(let radius=15;radius<=240;radius+=15)for(const candidate of[x-radius,x+radius]){const surface=findHuancavelicaV2SurfaceBelow(room,candidate,0,HUANCAVELICA_V2_WORLD_HEIGHT);if(surface!=null&&huancavelicaV2LandingHasRun(room,candidate,surface,18,85))return{x:candidate,surface};}return null;}
function snapPickups(room){if(!isV2(room))return;room.pickups=(room.pickups??[]).filter(box=>{const support=safePickupSurface(room,Number(box.x),Math.max(0,Number(box.y??0)));if(!support)return false;box.x=Math.round(support.x);box.y=Math.round(support.surface-24);return true;});}

function fireOnV2(id){const room=findRoomBySocket(id);installV2Arena(room);const result=baseFire(id);if(result?.ok&&isV2(result.room)){installV2Arena(result.room);adjustProjectile(result.room,result.room.match?.projectile);}return result;}
function advanceOnV2(code,now=Date.now()){
  const room=getRoom(code);if(!isV2(room))return baseAdvance(code,now);installV2Arena(room);const knownIds=new Set(room.arena?.craters?.map(crater=>crater.id)??[]),hints=projectileCraterHints(room.match?.projectile),before=new Map(room.players.map(player=>[player.id,{alive:player.alive,hp:player.hp,spawn:player.spawn?{...player.spawn}:null,lastDamageAt:player.lastDamage?.at}]));const changed=baseAdvance(code,now),target=changed??room;if(target&&isV2(target)){bindNewCraters(target,knownIds,hints);installV2Arena(target);settleUnsupported(target,before);snapPickups(target);}return changed;
}

function decoratePublic(room,state){
  const presets=[...(state?.terrainPresets??[])];if(!presets.some(entry=>entry.id===HUANCAVELICA_V2_ID))presets.push({id:HUANCAVELICA_V2_ID,name:HUANCAVELICA_V2_NAME,terrainRevision:HUANCAVELICA_V2_REVISION});state.terrainPresets=presets;
  if(isV2(room)){installV2Arena(room);state=basePublic(room);state.terrainPresets=presets;state.terrainPreset=HUANCAVELICA_V2_ID;state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_V2_ID,terrainName:HUANCAVELICA_V2_NAME,phase11Theme:HUANCAVELICA_V2_ID,terrainRevision:HUANCAVELICA_V2_REVISION,collisionModel:HUANCAVELICA_V2_COLLISION_MODEL,platforms:[],worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,bitmapTerrain:{width:HUANCAVELICA_V2_IMAGE_WIDTH,height:HUANCAVELICA_V2_IMAGE_HEIGHT,worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,uniformScale:HUANCAVELICA_V2_SCALE,maskSource:'cleaned-terrain-alpha-guided-by-supplied-mask'}};state.phase11Map={id:HUANCAVELICA_V2_ID,name:HUANCAVELICA_V2_NAME,terrainRevision:HUANCAVELICA_V2_REVISION,collisionModel:HUANCAVELICA_V2_COLLISION_MODEL,oneIslandOnePlayableSurface:true,oldPlatformGraphAuthority:false,normalMovementStep:WALK_STEP,normalWalkableSurfaceDelta:MAX_WALK_SURFACE_DELTA,normalJumpDistance:NORMAL_JUMP_DISTANCE,adaptiveMaxDistance:EXTENDED_MAX_DISTANCE,productionReady:true};}
  return state;
}

export function publicRoomState11(room){if(isV2(room))installV2Arena(room);return decoratePublic(room,basePublic(room));}
export function setTerrain11(id,terrain){const requested=typeof terrain==='string'?terrain.toLowerCase():null;if(!requested)return{ok:false,error:'invalid_terrain'};const v2=requested===HUANCAVELICA_V2_ID,result=baseSetTerrain(id,v2?COLLISION_BASE:requested);if(!result.ok)return result;result.room.phase11TerrainAlias=v2?HUANCAVELICA_V2_ID:null;result.room.phase11TerrainRevision=v2?HUANCAVELICA_V2_REVISION:null;result.room.phase11SpawnKey=null;for(const player of result.room.players??[])player.ready=false;if(v2)installV2Arena(result.room);return result;}
export function moveActivePlayer11(id,direction){const room=findRoomBySocket(id);return isV2(room)?moveOnV2(id,direction):baseMove(id,direction);}
export function jumpActivePlayer11(id,direction){const room=findRoomBySocket(id);return isV2(room)?jumpOnV2(id,direction):baseJump(id,direction);}
export function fireProjectile11(id){const room=findRoomBySocket(id);return isV2(room)?fireOnV2(id):baseFire(id);}
export function advanceTurnIfDue11(code,now=Date.now()){return advanceOnV2(code,now);}
export function rematchRoom11(id,options={}){const room=findRoomBySocket(id),keepV2=isV2(room)&&!options?.randomMap,result=baseRematch(id,options);if(result?.ok){result.room.phase11TerrainAlias=keepV2?HUANCAVELICA_V2_ID:null;result.room.phase11TerrainRevision=keepV2?HUANCAVELICA_V2_REVISION:null;result.room.phase11SpawnKey=null;if(keepV2)installV2Arena(result.room);}return result;}

export const publicRoomState9=publicRoomState11;
export const setTerrain9=setTerrain11;
export const moveActivePlayer9=moveActivePlayer11;
export const jumpActivePlayer9=jumpActivePlayer11;
export const fireProjectile9=fireProjectile11;
export const advanceTurnIfDue9=advanceTurnIfDue11;
export const rematchRoom9=rematchRoom11;
export {disconnectPlayer9,phase10HuancavelicaTestHooks,phase9AirPickupTestHooks,phase9TestHooks,phase9TraversalTestHooks,selectItem9,setAim9};
export const phase11HuancavelicaV2TestHooks=Object.freeze({SPAWN_IMAGE_HINTS,isV2,installV2Arena,spawnAtHint,moveOnV2,landingAt,jumpOnV2,ensureMuzzleOutside,adjustProjectile,bindNewCraters,settleUnsupported,safePickupSurface,requiredApex});
