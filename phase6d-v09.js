import { findRoomBySocket, getRoom } from './rooms.js';
import {
  advanceTurnIfDue6D as baseAdvance,
  fireProjectile6D as baseFire,
  jumpActivePlayer6D as baseJump,
  moveActivePlayer6D as baseMove,
  publicRoomState6D as basePublic,
  selectItem6D as baseSelect
} from './phase6d.js';

const MAX_HP=100;
const BASIC_DAMAGE=10;
const BASIC_RADIUS=260;
const HEAVY_DAMAGE=20;
const HEAVY_RADIUS=320;
const TRIPLE_DAMAGE_PER_HIT=10;
const CLUSTER_DAMAGE=14;
const CLUSTER_RADIUS=150;
const AIR_STRIKE_DAMAGE_PER_HIT=5;
const VEHICLE_HIT_RADIUS=51;
const HEAL_AMOUNT=20;
const SHIELD_FACTOR=.5;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const copyShield=s=>s?{...s}:null;

function resultFor(room){
  const alive=room.players.filter(p=>p.alive!==false);
  if(room.mode==='survival'){
    if(alive.length>1)return null;
    return{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:alive.length===0};
  }
  const teams=[...new Set(alive.map(p=>p.team))];
  if(teams.length>1)return null;
  return{type:'team',winnerTeam:teams[0]??null,draw:teams.length===0};
}

function snapshotAttack(room,q){
  if(!room||!q||q.v09CombatSnapshot)return;
  q.v09CombatSnapshot={
    hp:Object.fromEntries(room.players.map(p=>[p.id,p.hp??MAX_HP])),
    alive:Object.fromEntries(room.players.map(p=>[p.id,p.alive!==false])),
    spawn:Object.fromEntries(room.players.map(p=>[p.id,p.spawn?{...p.spawn}:null])),
    shield:Object.fromEntries(room.players.map(p=>[p.id,copyShield(p.shield)]))
  };
  q.v09ShieldHitPlayerIds=[];
}

function isVoidDeath(player){
  return player?.motion?.type==='knockbackVoid'||Number(player?.spawn?.y)>5000||Number(player?.motion?.toY)>5000;
}

function applyCorrectedHp(room,q,damageByPlayer,now,{consumeShield=true}={}){
  const snap=q?.v09CombatSnapshot;if(!snap)return false;
  let changed=false;
  for(const player of room.players){
    const baseHp=snap.hp[player.id],wasAlive=snap.alive[player.id],raw=Math.max(0,Math.round(damageByPlayer[player.id]??0));
    if(baseHp==null||wasAlive===false||raw<=0)continue;
    if(isVoidDeath(player))continue;
    const hadShield=Boolean(snap.shield[player.id]);
    const damage=hadShield?Math.max(1,Math.ceil(raw*SHIELD_FACTOR)):raw;
    const hp=Math.max(0,baseHp-damage);
    if(player.hp!==hp||player.lastDamage?.amount!==damage)changed=true;
    player.hp=hp;player.alive=hp>0;
    player.lastDamage={amount:damage,at:now,sourcePlayerId:q.ownerPlayerId};
    if(hp<=0)player.motion=null;
    if(hadShield){
      if(consumeShield)player.shield=null;
      else player.shield=copyShield(snap.shield[player.id]);
    }
  }
  room.match.pendingResult=resultFor(room);
  return changed;
}

function radialDamage(q,maxDamage,radius,{directMax=false}={}){
  const out={};const snap=q.v09CombatSnapshot;
  if(!snap)return out;
  for(const [id,spawn] of Object.entries(snap.spawn)){
    if(!spawn||snap.alive[id]===false)continue;
    const d=Math.hypot(spawn.x-q.impactX,(spawn.y-10)-q.impactY);
    if(d>radius)continue;
    let damage=Math.max(1,Math.round(maxDamage*(1-d/radius)));
    if(directMax&&q.hitPlayerId===id)damage=maxDamage;
    out[id]=clamp(damage,1,maxDamage);
  }
  return out;
}

function tripleDamage(q){
  const out={};
  for(const shot of q.volley??[]){
    if(shot?.impactReason!=='player'||!shot.hitPlayerId)continue;
    out[shot.hitPlayerId]=(out[shot.hitPlayerId]??0)+TRIPLE_DAMAGE_PER_HIT;
  }
  return out;
}

function clusterDamage(q){
  const out={};const snap=q.v09CombatSnapshot;if(!snap)return out;
  for(const impact of q.clusterImpacts??[]){
    if(Number(impact?.y)>=5000)continue;
    for(const [id,spawn] of Object.entries(snap.spawn)){
      if(!spawn||snap.alive[id]===false)continue;
      const d=Math.hypot(spawn.x-impact.x,(spawn.y-10)-impact.y);
      if(d>CLUSTER_RADIUS)continue;
      out[id]=(out[id]??0)+Math.max(1,Math.round(CLUSTER_DAMAGE*(1-d/CLUSTER_RADIUS)));
    }
  }
  return out;
}

function correctResolvedBallistic(room,q,now){
  if(!q||q.weaponType==='nuke'||q.weaponType==='airstrike')return false;
  if(q.weaponType==='basic'&&q.resolutionApplied&&!q.v09DamageAdjusted){
    q.v09DamageAdjusted=true;
    return applyCorrectedHp(room,q,radialDamage(q,BASIC_DAMAGE,BASIC_RADIUS,{directMax:true}),now);
  }
  if(q.weaponType==='heavy'&&q.heavyResolutionApplied&&!q.v09DamageAdjusted){
    q.v09DamageAdjusted=true;
    return applyCorrectedHp(room,q,radialDamage(q,HEAVY_DAMAGE,HEAVY_RADIUS,{directMax:true}),now);
  }
  if(q.weaponType==='triple'&&q.specialResolutionApplied&&!q.v09DamageAdjusted){
    q.v09DamageAdjusted=true;
    return applyCorrectedHp(room,q,tripleDamage(q),now);
  }
  if(q.weaponType==='cluster'&&q.specialResolutionApplied&&!q.v09DamageAdjusted){
    q.v09DamageAdjusted=true;
    return applyCorrectedHp(room,q,clusterDamage(q),now);
  }
  return false;
}

function newlyAppliedAirShells(q,before){
  const appliedBefore=new Set(before??[]);
  return(q?.airStrikeShells??[]).filter(shell=>shell.applied&&!appliedBefore.has(shell.index));
}

function correctAirStrike(room,q,beforeHp,beforeApplied,now){
  const shells=newlyAppliedAirShells(q,beforeApplied);
  if(!shells.length)return false;
  const snap=q.v09CombatSnapshot;if(!snap)return false;
  const shieldHits=new Set(q.v09ShieldHitPlayerIds??[]);
  for(const player of room.players){
    if(snap.alive[player.id]===false||!player.spawn||isVoidDeath(player))continue;
    let hits=0;
    for(const shell of shells){
      const distance=Math.hypot(player.spawn.x-shell.x,(player.spawn.y-10)-shell.y);
      if(distance<=VEHICLE_HIT_RADIUS)hits+=1;
    }
    const startHp=beforeHp[player.id];if(startHp==null)continue;
    const hadShield=Boolean(snap.shield[player.id]);
    const raw=hits*AIR_STRIKE_DAMAGE_PER_HIT;
    if(raw>0&&hadShield)shieldHits.add(player.id);
    const damage=raw>0?(hadShield?Math.max(1,Math.ceil(raw*SHIELD_FACTOR)):raw):0;
    player.hp=Math.max(0,startHp-damage);player.alive=player.hp>0;
    if(damage>0)player.lastDamage={amount:damage,at:now,sourcePlayerId:q.ownerPlayerId};
    const allApplied=(q.airStrikeShells??[]).every(shell=>shell.applied);
    if(hadShield)player.shield=allApplied&&shieldHits.has(player.id)?null:copyShield(snap.shield[player.id]);
  }
  q.v09ShieldHitPlayerIds=[...shieldHits];
  room.match.pendingResult=resultFor(room);
  return true;
}

export function fireProjectile6DV09(id){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id),beforeHp=player?.hp??null;
  const result=baseFire(id);
  if(!result.ok)return result;
  const q=result.room.match?.projectile;
  if(q)snapshotAttack(result.room,q);
  if(!q&&player?.lastUtility?.type==='heal'&&beforeHp!=null){
    const desired=Math.min(MAX_HP,beforeHp+HEAL_AMOUNT),healed=desired-beforeHp;
    player.hp=desired;player.lastUtility={...player.lastUtility,label:`HEAL +${healed} HP`,amount:healed};
    result.healed=healed;
  }
  return result;
}

export function advanceTurnIfDue6DV09(code,now=Date.now()){
  const room=getRoom(code),q=room?.match?.projectile;
  if(q)snapshotAttack(room,q);
  const beforeHp=q?Object.fromEntries(room.players.map(p=>[p.id,p.hp??MAX_HP])):{};
  const beforeApplied=q?.weaponType==='airstrike'?(q.airStrikeShells??[]).filter(s=>s.applied).map(s=>s.index):[];
  const changed=baseAdvance(code,now);
  const target=changed??room;
  if(!target||!q)return changed;
  if(q.weaponType==='airstrike')correctAirStrike(target,q,beforeHp,beforeApplied,now);
  else correctResolvedBallistic(target,q,now);
  return changed??target;
}

export function publicRoomState6DV09(room){
  const state=basePublic(room);
  state.v09CombatBalance={
    maxHp:MAX_HP,basicMaxDamage:BASIC_DAMAGE,heavyMaxDamage:HEAVY_DAMAGE,
    tripleDamagePerDirectHit:TRIPLE_DAMAGE_PER_HIT,clusterMaxDamagePerImpact:CLUSTER_DAMAGE,
    airStrikeDamagePerDirectHit:AIR_STRIKE_DAMAGE_PER_HIT,nukeDamage:20,healAmount:HEAL_AMOUNT,
    shieldFactor:SHIELD_FACTOR,shieldDuration:'one complete incoming attack',vehicleHitRadius:VEHICLE_HIT_RADIUS
  };
  if(Array.isArray(state.itemPool))state.itemPool=state.itemPool.map(item=>item.type==='heal'?{...item,label:'HEAL +20'}:item);
  if(state.healRules)state.healRules={...state.healRules,amount:HEAL_AMOUNT};
  if(state.airStrikeRules)state.airStrikeRules={...state.airStrikeRules,damagePerShell:AIR_STRIKE_DAMAGE_PER_HIT,directHitRadius:VEHICLE_HIT_RADIUS};
  return state;
}

export function moveActivePlayer6DV09(id,d){return baseMove(id,d);}
export function jumpActivePlayer6DV09(id,d){return baseJump(id,d);}
export function selectItem6DV09(id,slot){return baseSelect(id,slot);}
