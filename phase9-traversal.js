import { findRoomBySocket } from './rooms.js';
import { phase7aHotfixTestHooks } from './phase7a-hotfix.js';
import {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9 as baseJump,
  moveActivePlayer9,
  publicRoomState9 as basePublic,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
} from './phase9.js';

const WORLD_WIDTH=5000;
const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const NORMAL_JUMP_DISTANCE=180;
const EXTENDED_MIN_DISTANCE=210;
const EXTENDED_MAX_DISTANCE=420;
const EXTENDED_STEP=15;
const MIN_TRUNCATED_DISTANCE=150;
const BASE_APEX=150;
const MAX_ADAPTIVE_APEX=1050;
const CLEARANCE=18;
const MIN_LANDING_RUN=28;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const surface=(room,x)=>phase7aHotfixTestHooks.surface(room,x);

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

export function jumpActivePlayer9Traversal(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id),from=player?.spawn?{...player.spawn}:null;
  const dir=Number(direction)<0?-1:Number(direction)>0?1:(player?.spawn?.facing||1);
  const result=baseJump(id,direction);
  if(result.ok&&from&&player)maybeExtendTruncatedJump(result.room,player,from,dir);
  return result;
}

export function publicRoomState9Traversal(room){
  const state=basePublic(room);
  state.movementRules={...(state.movementRules??{}),adaptiveLedgeVault:true,normalJumpDistance:NORMAL_JUMP_DISTANCE,adaptiveMaxDistance:EXTENDED_MAX_DISTANCE,adaptiveMaxApex:MAX_ADAPTIVE_APEX};
  return state;
}

export const jumpActivePlayer9=jumpActivePlayer9Traversal;
export const publicRoomState9=publicRoomState9Traversal;

export {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  moveActivePlayer9,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
};

export const phase9TraversalTestHooks=Object.freeze({requiredApex,landingHasRun,findAdaptiveLanding,maybeExtendTruncatedJump});
