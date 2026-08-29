import { findRoomBySocket } from './rooms.js';
import { phase7a1TestHooks } from './phase7a1.js';
import { phase7aHotfixTestHooks } from './phase7a-hotfix.js';
import {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9 as baseJump,
  moveActivePlayer9 as baseMove,
  phase9TestHooks,
  publicRoomState9 as basePublic,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
} from './phase9-core.js';

const WORLD_WIDTH=5000;
const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const WALK_STEP=15;
const MAX_WALK_SURFACE_DELTA=42;
const NORMAL_JUMP_DISTANCE=180;
const EXTENDED_MIN_DISTANCE=210;
const EXTENDED_MAX_DISTANCE=420;
const EXTENDED_STEP=15;
const MIN_TRUNCATED_DISTANCE=150;
const BASE_APEX=150;
const MAX_ADAPTIVE_APEX=1050;
const CLEARANCE=18;
const MIN_LANDING_RUN=28;
const DROP_MIN_MS=260;
const DROP_MAX_MS=1100;
const EMBED_TOLERANCE=10;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const surface=(room,x)=>phase7aHotfixTestHooks.surface(room,x);

function reconcileEmbeddedPlayer(room,player){
  if(!room||!player?.spawn||player.alive===false)return false;
  const x=clamp(Number(player.spawn.x)||0,40,WORLD_WIDTH-40),ground=surface(room,x);
  if(ground>=WORLD_HEIGHT-1)return false;
  const validY=Math.round(ground-GROUND_OFFSET),currentY=Number(player.spawn.y);
  if(!Number.isFinite(currentY)||currentY<=validY+EMBED_TOLERANCE)return false;
  player.spawn={...player.spawn,x,y:validY};
  player.motion=null;
  player.terrainReconciledAt=Date.now();
  return true;
}

function requiredApex(room,from,toX,toY){
  const dx=toX-from.x;
  let required=Math.max(BASE_APEX,from.y-toY+72);
  for(let i=2;i<48;i+=1){
    const t=i/48,s=Math.sin(Math.PI*t);
    if(s<.08)continue;
    const x=from.x+dx*t,ground=surface(room,x);
    if(ground>=WORLD_HEIGHT-1)continue;
    const base=from.y+(toY-from.y)*t,limit=ground-GROUND_OFFSET-CLEARANCE;
    required=Math.max(required,(base-limit)/s);
  }
  return Math.ceil(required);
}

function landingHasRun(room,x,dir){
  const center=surface(room,x);if(center>=WORLD_HEIGHT-1)return false;
  for(const offset of [dir*MIN_LANDING_RUN,-dir*Math.min(18,MIN_LANDING_RUN)]){
    const y=surface(room,clamp(x+offset,40,WORLD_WIDTH-40));
    if(y>=WORLD_HEIGHT-1||Math.abs(y-center)>75)return false;
  }
  return true;
}

function findAdaptiveLanding(room,from,dir){
  for(let distance=EXTENDED_MIN_DISTANCE;distance<=EXTENDED_MAX_DISTANCE;distance+=EXTENDED_STEP){
    const x=clamp(from.x+dir*distance,40,WORLD_WIDTH-40);
    if(Math.abs(x-from.x)<EXTENDED_MIN_DISTANCE-1)continue;
    const ground=surface(room,x);if(ground>=WORLD_HEIGHT-1||!landingHasRun(room,x,dir))continue;
    const y=Math.round(ground-GROUND_OFFSET),apex=requiredApex(room,from,x,y);
    if(apex>MAX_ADAPTIVE_APEX)continue;
    return{x,y,apex,distance:Math.abs(x-from.x)};
  }
  return null;
}

function maybeExtendTruncatedJump(room,player,from,dir){
  if(!player?.spawn||player.alive===false||player.spawn.y>WORLD_HEIGHT)return false;
  const moved=Math.abs(player.spawn.x-from.x);
  if(moved>=MIN_TRUNCATED_DISTANCE)return false;
  if(player.motion?.type!=='jump')return false;
  const landing=findAdaptiveLanding(room,from,dir);if(!landing)return false;
  const startedAt=Number(player.motion.startedAt)||Date.now();
  const duration=Math.round(clamp(500+(landing.distance-NORMAL_JUMP_DISTANCE)*1.1,520,780));
  player.spawn={x:landing.x,y:landing.y,facing:dir};
  player.motion={type:'jump',startedAt,endsAt:startedAt+duration,fromX:from.x,fromY:from.y,toX:landing.x,toY:landing.y,apex:landing.apex,adaptiveLedgeVault:true};
  return true;
}

function naturalDropTarget(room,from,dir){
  if(!room||!from)return null;
  const x=clamp(from.x+dir*WALK_STEP,40,WORLD_WIDTH-40);
  const ground=surface(room,x);
  if(ground>=WORLD_HEIGHT-1)return null;
  const y=Math.round(ground-GROUND_OFFSET),drop=y-from.y;
  if(drop<=MAX_WALK_SURFACE_DELTA)return null;
  return{x,y,drop};
}

function applyNaturalDrop(room,player,from,dir){
  if(!player?.spawn||player.alive===false)return false;
  const target=naturalDropTarget(room,from,dir);if(!target)return false;
  const now=Date.now(),duration=Math.round(clamp(target.drop*2.2,DROP_MIN_MS,DROP_MAX_MS));
  player.spawn={x:target.x,y:target.y,facing:dir};
  player.motion={type:'fall',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:target.x,toY:target.y,apex:0,naturalLedgeDrop:true};
  return true;
}

function collectAfterTraversal(room,player,id){
  const before=phase7a1TestHooks.snapshot(room);
  if(phase9TestHooks.collectOneByTouch(room,player))phase7a1TestHooks.observe(room,before,{actorId:id,sourceId:id,weaponType:'movement'});
  phase9TestHooks.maintainPhase9Pickups(room);
}

export function moveActivePlayer9Traversal(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);
  if(room&&player)reconcileEmbeddedPlayer(room,player);
  const from=player?.spawn?{...player.spawn}:null;
  const dir=Number(direction)<0?-1:Number(direction)>0?1:(player?.spawn?.facing||1);
  const result=baseMove(id,direction);
  if(result.ok||result.error!=='terrain_too_steep'||!room||!player||!from)return result;
  if(!applyNaturalDrop(room,player,from,dir))return result;
  collectAfterTraversal(room,player,id);
  return{ok:true,room,naturalDrop:true};
}

export function jumpActivePlayer9Traversal(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);
  if(room&&player)reconcileEmbeddedPlayer(room,player);
  const from=player?.spawn?{...player.spawn}:null;
  const dir=Number(direction)<0?-1:Number(direction)>0?1:(player?.spawn?.facing||1);
  const result=baseJump(id,direction);
  if(result.ok&&from&&player)maybeExtendTruncatedJump(result.room,player,from,dir);
  return result;
}

export function publicRoomState9Traversal(room){
  const state=basePublic(room);
  state.movementRules={...(state.movementRules??{}),adaptiveLedgeVault:true,naturalLedgeDrop:true,terrainEmbedRecovery:true,normalJumpDistance:NORMAL_JUMP_DISTANCE,adaptiveMaxDistance:EXTENDED_MAX_DISTANCE,adaptiveMaxApex:MAX_ADAPTIVE_APEX};
  return state;
}

export const moveActivePlayer9=moveActivePlayer9Traversal;
export const jumpActivePlayer9=jumpActivePlayer9Traversal;
export const publicRoomState9=publicRoomState9Traversal;

export {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  phase9TestHooks,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
};

export const phase9TraversalTestHooks=Object.freeze({reconcileEmbeddedPlayer,requiredApex,landingHasRun,findAdaptiveLanding,maybeExtendTruncatedJump,naturalDropTarget,applyNaturalDrop});
