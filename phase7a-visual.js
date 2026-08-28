import { getRoom } from './rooms.js';
import { phase7a1TestHooks } from './phase7a1.js';
import {
  advanceTurnIfDue7AHotfix as baseAdvance,
  disconnectPlayer7AHotfix as baseDisconnect,
  fireProjectile7AHotfix as baseFire,
  jumpActivePlayer7AHotfix as baseJump,
  moveActivePlayer7AHotfix as baseMove,
  phase7aHotfixTestHooks,
  publicRoomState7AHotfix as basePublic,
  rematchRoom7AHotfix as baseRematch,
  selectItem7AHotfix as baseSelect,
  setAim7AHotfix as baseAim,
  setTerrain7AHotfix as baseTerrain
} from './phase7a-hotfix.js';

const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const AIR_STRIKE_FALL_MS=4000;
const AIR_STRIKE_STAGGER_MS=233;
const AIR_STRIKE_START_RISE=900;
const PROJECTILE_LAUNCH_HOLD_MS=567;
const NUKE_DAMAGE=20;
const NUKE_SCAR_RADIUS=118;
const NUKE_SCAR_DEPTH=230;
const NUKE_SCAR_STEP=90;
const NUKE_SCAR_MARGIN=55;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function distanceToSegment(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;if(len2<=.0001)return Math.hypot(px-ax,py-ay);const t=clamp(((px-ax)*dx+(py-ay)*dy)/len2,0,1);return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));}

function shiftTime(value,delay){return Number.isFinite(value)?value+delay:value;}
function delayAuthoritativeProjectile(room,q,delay=PROJECTILE_LAUNCH_HOLD_MS){
  if(!q||q.weaponType==='airstrike'||q.authoritativeVisualDelay7A)return;
  q.authoritativeVisualDelay7A=delay;
  q.startedAt=shiftTime(q.startedAt,delay);
  q.impactAt=shiftTime(q.impactAt,delay);
  q.resolveAt=shiftTime(q.resolveAt,delay);
  q.specialResolveAt=shiftTime(q.specialResolveAt,delay);
  q.targetLockedAt=shiftTime(q.targetLockedAt,delay);
  q.warningUntil=shiftTime(q.warningUntil,delay);
  q.beamAt=shiftTime(q.beamAt,delay);
  q.beamUntil=shiftTime(q.beamUntil,delay);
  if(Array.isArray(q.volley))q.volley=q.volley.map(v=>({...v,startedAt:shiftTime(v.startedAt,delay),impactAt:shiftTime(v.impactAt,delay),resolveAt:shiftTime(v.resolveAt,delay)}));
  if(Array.isArray(q.clusterImpacts))q.clusterImpacts=q.clusterImpacts.map(v=>({...v,visualStartAt:shiftTime(v.visualStartAt,delay),impactAt:shiftTime(v.impactAt,delay)}));
  if(Number.isFinite(q.resolveAt))room.match.turnEndsAt=q.resolveAt;
}

function paceAirStrike(room,q){
  if(!q||q.weaponType!=='airstrike'||q.airVisualPacing7A)return;
  q.airVisualPacing7A=true;
  const warningEnd=q.warningUntil??Date.now();
  q.airStrikeShells=(q.airStrikeShells??[]).map((shell,index)=>{
    const visualStartAt=warningEnd+index*AIR_STRIKE_STAGGER_MS;
    const impactAt=visualStartAt+AIR_STRIKE_FALL_MS;
    return {...shell,startY:Math.max(80,shell.y-AIR_STRIKE_START_RISE),visualStartAt,impactAt};
  });
  if(q.airStrikeShells.length){
    q.impactAt=q.airStrikeShells[0].impactAt;
    q.specialResolveAt=q.airStrikeShells.at(-1).impactAt;
    q.resolveAt=q.specialResolveAt+900;
    room.match.turnEndsAt=q.resolveAt;
  }
}

function applySafeNuke(room,q,now){
  if(!q||q.weaponType!=='nuke'||q.nukeApplied||!q.nukeBeam)return false;
  q.nukeApplied=true;
  q.pendingVoidDeathIds=[];
  const {ax,ay,bx,by}=q.nukeBeam;
  const halfWidth=q.nukeBeam.halfWidth??115;

  for(const player of room.players){
    if(player.alive===false||!player.spawn)continue;
    const d=distanceToSegment(player.spawn.x,player.spawn.y-10,ax,ay,bx,by);
    if(d>halfWidth)continue;
    let damage=NUKE_DAMAGE;
    if(player.shield){damage=Math.max(1,Math.ceil(damage*player.shield.factor));player.shield=null;}
    player.hp=Math.max(0,(player.hp??100)-damage);
    player.lastDamage={amount:damage,at:now,sourcePlayerId:q.ownerPlayerId};
    if(player.hp<=0)player.alive=false;
  }

  const halfLength=Math.max(1,Math.abs(bx-ax)/2);
  for(let x=(q.targetX??((ax+bx)/2))-halfLength,index=0;x<=(q.targetX??((ax+bx)/2))+halfLength;x+=NUKE_SCAR_STEP,index+=1){
    const cx=clamp(x,30,4970);
    const cy=phase7aHotfixTestHooks.surface(room,cx);
    if(cy>=WORLD_HEIGHT-1)continue;
    if(distanceToSegment(cx,cy,ax,ay,bx,by)>halfWidth+NUKE_SCAR_MARGIN)continue;
    room.arena.craters.push({id:`${q.id}-nuke-scar-${index}`,x:cx,radius:NUKE_SCAR_RADIUS,depth:NUKE_SCAR_DEPTH,createdAt:now});
  }

  room.pickups=(room.pickups??[]).filter(box=>distanceToSegment(box.x,box.y,ax,ay,bx,by)>halfWidth+45);

  for(const player of room.players){
    if(player.alive===false||!player.spawn)continue;
    const nextY=phase7aHotfixTestHooks.surface(room,player.spawn.x);
    if(nextY>=WORLD_HEIGHT-1)continue;
    const targetY=nextY-GROUND_OFFSET;
    if(targetY<=player.spawn.y+2)continue;
    const fromY=player.spawn.y;
    player.spawn={...player.spawn,y:Math.round(targetY)};
    player.motion={type:'fall',startedAt:now,endsAt:now+Math.min(1100,Math.max(350,(targetY-fromY)*2.2)),fromX:player.spawn.x,fromY,toX:player.spawn.x,toY:Math.round(targetY),apex:0};
  }
  return true;
}

export function publicRoomState7AVisual(room){
  const state=basePublic(room);
  state.visualHardening={
    projectileTrail:'full-flight',
    projectileAuthority:'single-authoritative-timeline',
    projectileLaunchHoldMs:PROJECTILE_LAUNCH_HOLD_MS,
    airStrikeFallMs:AIR_STRIKE_FALL_MS,
    airStrikeStaggerMs:AIR_STRIKE_STAGGER_MS,
    projectilePlaybackSpeedMultiplier:1.5,
    nukeTerrainMode:'diagonal-scar',
    nukeScarDepth:NUKE_SCAR_DEPTH,
    nukeDamage:NUKE_DAMAGE
  };
  return state;
}

export function fireProjectile7AVisual(id){
  const result=baseFire(id);
  if(!result.ok)return result;
  const q=result.room.match?.projectile;
  if(q?.weaponType==='airstrike')paceAirStrike(result.room,q);
  else delayAuthoritativeProjectile(result.room,q);
  return result;
}

export function advanceTurnIfDue7AVisual(code,now=Date.now()){
  const room=getRoom(code),q=room?.match?.projectile;
  if(room&&q?.weaponType==='nuke'&&!q.nukeApplied&&now>=q.beamAt){
    const before=phase7a1TestHooks.snapshot(room);
    if(applySafeNuke(room,q,now))phase7a1TestHooks.observe(room,before,{sourceId:q.ownerPlayerId,weaponType:'nuke'});
  }
  return baseAdvance(code,now);
}

export function moveActivePlayer7AVisual(id,d){return baseMove(id,d);}
export function jumpActivePlayer7AVisual(id,d){return baseJump(id,d);}
export function setAim7AVisual(id,a,p){return baseAim(id,a,p);}
export function selectItem7AVisual(id,s){return baseSelect(id,s);}
export function setTerrain7AVisual(id,t){return baseTerrain(id,t);}
export function disconnectPlayer7AVisual(id){return baseDisconnect(id);}
export function rematchRoom7AVisual(id,options={}){return baseRematch(id,options);}

export const phase7aVisualTestHooks=Object.freeze({paceAirStrike,applySafeNuke,distanceToSegment,delayAuthoritativeProjectile});
