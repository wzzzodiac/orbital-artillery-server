import { randomInt } from 'node:crypto';
import { findRoomBySocket, getRoom } from './rooms.js';
import { PHASE6E_ITEM_POOL, PHASE6E_POOL_TOTAL, chooseBalancedItem6E } from './phase6e.js';
import { phase7a1TestHooks } from './phase7a1.js';
import { phase7aHotfixTestHooks } from './phase7a-hotfix.js';
import {
  advanceTurnIfDue7AVisual as baseAdvance,
  disconnectPlayer7AVisual as baseDisconnect,
  fireProjectile7AVisual as baseFire,
  jumpActivePlayer7AVisual as baseJump,
  moveActivePlayer7AVisual as baseMove,
  publicRoomState7AVisual as basePublic,
  rematchRoom7AVisual as baseRematch,
  selectItem7AVisual as baseSelect,
  setAim7AVisual as baseAim,
  setTerrain7AVisual as baseTerrain
} from './phase7a-visual.js';

const WORLD_WIDTH=5000;
const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const PICKUP_RADIUS=64;
const PICKUP_LIFETIME_TURNS=4;
const EARLY_PICKUP_EVERY=3;
const FRENZY_START_TURN=10;
const MAX_PICKUPS=4;
const INVENTORY_SIZE=2;
const HEAL_LABEL='HEAL +20';
const BLOCKED_SLOT=Object.freeze({type:'__phase9_collection_block__',label:'BLOCKED'});

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const surface=(room,x)=>phase7aHotfixTestHooks.surface(room,x);

function normalizeHealLabels(room){
  if(!room)return false;
  let changed=false;
  for(const box of room.pickups??[]){if(box?.type==='heal'&&box.label!==HEAL_LABEL){box.label=HEAL_LABEL;changed=true;}}
  for(const player of room.players??[]){
    for(const item of player.inventory??[]){if(item?.type==='heal'&&item.label!==HEAL_LABEL){item.label=HEAL_LABEL;changed=true;}}
    if(player.lastPickup?.type==='heal'&&player.lastPickup.label!==HEAL_LABEL){player.lastPickup.label=HEAL_LABEL;changed=true;}
  }
  return changed;
}

function ensurePhase9(room){
  if(!room)return room;
  if(!Array.isArray(room.pickups))room.pickups=[];
  if(!Number.isInteger(room.phase9PickupAttemptTurn))room.phase9PickupAttemptTurn=0;
  for(const player of room.players??[]){
    if(!Array.isArray(player.inventory))player.inventory=Array(INVENTORY_SIZE).fill(null);
    if(!Number.isInteger(player.pickupCollectedTurn))player.pickupCollectedTurn=-1;
  }
  normalizeHealLabels(room);
  return room;
}

function livingPlayersByX(room){return(room.players??[]).filter(p=>p.spawn&&p.alive!==false).sort((a,b)=>a.spawn.x-b.spawn.x);}

function fairPickupCandidates(room){
  const players=livingPlayersByX(room);if(players.length<2)return[];
  const gaps=[];
  for(let i=0;i<players.length-1;i+=1){const left=players[i],right=players[i+1],mid=(left.spawn.x+right.spawn.x)/2,gap=Math.max(1,right.spawn.x-left.spawn.x);gaps.push({index:i,left,right,mid,gap});}
  const nearestGapIndex=x=>{let best=0,bestDistance=Infinity;for(const gap of gaps){const d=Math.abs(x-gap.mid);if(d<bestDistance){bestDistance=d;best=gap.index;}}return best;};
  const occupancy=new Map(gaps.map(g=>[g.index,0]));
  for(const box of room.pickups??[]){const index=nearestGapIndex(box.x);occupancy.set(index,(occupancy.get(index)??0)+1);}
  const candidates=[];
  for(const gap of gaps){
    const spread=Math.min(180,Math.max(55,gap.gap*.16));
    for(const offset of [0,-spread,spread,-spread*2,spread*2]){
      let x=gap.mid+offset;if(gap.gap>220)x=clamp(x,gap.left.spawn.x+100,gap.right.spawn.x-100);else x=gap.mid;x=clamp(Math.round(x),140,WORLD_WIDTH-140);
      const y=surface(room,x);if(y>=WORLD_HEIGHT-1)continue;const py=Math.round(y-24);
      if(players.some(p=>Math.hypot(p.spawn.x-x,p.spawn.y-(y-GROUND_OFFSET))<110))continue;
      const clearance=(room.pickups??[]).length?Math.min(...room.pickups.map(box=>Math.hypot(box.x-x,box.y-py))):Infinity;if(clearance<95)continue;
      candidates.push({x,y:py,gapIndex:gap.index,occupancy:occupancy.get(gap.index)??0,fairnessError:Math.abs(x-gap.mid)/Math.max(1,gap.gap/2),clearance});
    }
  }
  candidates.sort((a,b)=>a.occupancy-b.occupancy||a.fairnessError-b.fairnessError||b.clearance-a.clearance||a.gapIndex-b.gapIndex||a.x-b.x);
  return candidates;
}

function fallbackPickupCandidates(room){
  const candidates=[];
  for(let x=140;x<=WORLD_WIDTH-140;x+=45){
    const y=surface(room,x);if(y>=WORLD_HEIGHT-1)continue;
    if(room.players.some(p=>p.spawn&&p.alive!==false&&Math.hypot(p.spawn.x-x,p.spawn.y-(y-GROUND_OFFSET))<110))continue;
    if(room.pickups.some(box=>Math.abs(box.x-x)<140))continue;
    candidates.push({x,y:Math.round(y-24)});
  }
  return candidates;
}

function chooseFairPoint(room){
  const fair=fairPickupCandidates(room);if(fair.length)return fair[0];
  const fallback=fallbackPickupCandidates(room);return fallback.length?fallback[randomInt(fallback.length)]:null;
}

function repositionNewPickupsFairly(room){
  ensurePhase9(room);if(!room?.match)return false;
  const turn=room.match.turnNumber??0;let changed=false;
  for(const box of [...room.pickups]){
    if(box.spawnTurn!==turn||box.phase9FairPlaced)continue;
    const index=room.pickups.indexOf(box);if(index<0)continue;
    room.pickups.splice(index,1);
    const point=chooseFairPoint(room);
    room.pickups.splice(index,0,box);
    if(point){box.x=point.x;box.y=point.y;changed=true;}
    box.phase9FairPlaced=true;
  }
  return changed;
}

function spawnPhase9Pickup(room){
  ensurePhase9(room);if(room.pickups.length>=MAX_PICKUPS)return false;
  const point=chooseFairPoint(room);if(!point)return false;
  const item=chooseBalancedItem6E(randomInt(PHASE6E_POOL_TOTAL)),turn=room.match?.turnNumber??0;
  room.pickups.push({id:`${room.code}-phase9-pickup-${turn}-${Date.now()}-${randomInt(1_000_000)}`,type:item.type,label:item.type==='heal'?HEAL_LABEL:item.label,x:point.x,y:point.y,spawnTurn:turn,expiresAfterTurn:turn+PICKUP_LIFETIME_TURNS-1,phase6ePoolRolled:true,phase9Spawn:true,phase9FairPlaced:true});
  return true;
}

function maintainPhase9Pickups(room){
  ensurePhase9(room);if(room?.status!=='started'||!room.match)return false;
  const turn=room.match.turnNumber??0;
  room.pickups=room.pickups.filter(box=>turn<=Number(box.expiresAfterTurn??turn));
  normalizeHealLabels(room);
  const repositioned=repositionNewPickupsFairly(room);
  if(turn<FRENZY_START_TURN)return repositioned;
  if(room.phase9PickupAttemptTurn===turn)return repositioned;
  room.phase9PickupAttemptTurn=turn;
  if(room.pickups.some(box=>box.spawnTurn===turn))return repositioned;
  return spawnPhase9Pickup(room)||repositioned;
}

function collectOneByTouch(room,player){
  ensurePhase9(room);if(!player?.spawn||player.alive===false)return false;
  const turn=room.match?.turnNumber??0;if(player.pickupCollectedTurn===turn)return false;
  const slot=player.inventory.findIndex(item=>item==null);if(slot<0)return false;
  let bestIndex=-1,bestDistance=Infinity;
  for(let i=0;i<room.pickups.length;i+=1){const box=room.pickups[i],distance=Math.hypot(player.spawn.x-box.x,(player.spawn.y-8)-box.y);if(distance<=PICKUP_RADIUS&&distance<bestDistance){bestDistance=distance;bestIndex=i;}}
  if(bestIndex<0)return false;
  const [box]=room.pickups.splice(bestIndex,1),label=box.type==='heal'?HEAL_LABEL:box.label;
  player.inventory[slot]={type:box.type,label,pickedAtTurn:turn};player.lastPickup={type:box.type,label,method:'touch',at:Date.now()};player.pickupCollectedTurn=turn;return true;
}

function runMovementWithPhase9Collection(id,action){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);if(!room||!player)return action();ensurePhase9(room);
  const inventoryBefore=player.inventory.map(item=>item?{...item}:null);player.inventory=player.inventory.map(item=>item??BLOCKED_SLOT);const result=action();player.inventory=inventoryBefore;if(!result?.ok)return result;
  const beforePickup=phase7a1TestHooks.snapshot(result.room);if(collectOneByTouch(result.room,player))phase7a1TestHooks.observe(result.room,beforePickup,{actorId:id,sourceId:id,weaponType:'movement'});maintainPhase9Pickups(result.room);return result;
}

function runAdvanceWithoutExplosionCollection(code,now){
  const room=getRoom(code),q=room?.match?.projectile,owner=room?.players.find(p=>p.id===q?.ownerPlayerId);let inventoryBefore=null;
  if(owner){ensurePhase9(room);inventoryBefore=owner.inventory.map(item=>item?{...item}:null);owner.inventory=owner.inventory.map(item=>item??BLOCKED_SLOT);}
  const changed=baseAdvance(code,now);if(owner&&inventoryBefore)owner.inventory=inventoryBefore;if(changed){normalizeHealLabels(changed);maintainPhase9Pickups(changed);}return changed;
}

export function publicRoomState9(room){
  ensurePhase9(room);let state=basePublic(room);if(maintainPhase9Pickups(room))state=basePublic(room);normalizeHealLabels(room);
  state.version='0.9.2-beta';state.phase='9';
  state.pickups=(state.pickups??[]).map(({phase6cPoolRolled,phase6dPoolRolled,phase6ePoolRolled,phase9FairPlaced,...box})=>box.type==='heal'?{...box,label:HEAL_LABEL}:box);
  state.players=(state.players??[]).map(player=>({...player,inventory:(player.inventory??[]).map(item=>item?.type==='heal'?{...item,label:HEAL_LABEL}:item)}));
  state.itemPool=PHASE6E_ITEM_POOL.map(item=>item.type==='heal'?{...item,label:HEAL_LABEL}:{...item});
  state.pickupRules={earlyEveryTurns:EARLY_PICKUP_EVERY,frenzyStartsAtTurn:FRENZY_START_TURN,frenzyEveryTurns:1,lifetimeTurns:PICKUP_LIFETIME_TURNS,maxOnMap:MAX_PICKUPS,inventorySize:INVENTORY_SIZE,maxCollectedPerPlayerTurn:1,collectByTouch:true,collectByExplosion:false,pickupEndsTurn:false,placement:'midpoints between adjacent living players, balanced across gaps'};
  state.balanceRules={...(state.balanceRules??{}),pickupEveryTurns:EARLY_PICKUP_EVERY,pickupFrenzyStartsAtTurn:FRENZY_START_TURN,pickupFrenzyEveryTurns:1,pickupLifetimeTurns:PICKUP_LIFETIME_TURNS,maxPickups:MAX_PICKUPS,pickupPlacement:'fair-midpoints'};
  return state;
}

export function advanceTurnIfDue9(code,now=Date.now()){return runAdvanceWithoutExplosionCollection(code,now);}
export function moveActivePlayer9(id,direction){return runMovementWithPhase9Collection(id,()=>baseMove(id,direction));}
export function jumpActivePlayer9(id,direction){return runMovementWithPhase9Collection(id,()=>baseJump(id,direction));}
export function setAim9(id,angle,power){return baseAim(id,angle,power);}
export function selectItem9(id,slot){return baseSelect(id,slot);}
export function fireProjectile9(id){const result=baseFire(id);if(result.ok){normalizeHealLabels(result.room);maintainPhase9Pickups(result.room);}return result;}
export function setTerrain9(id,terrain){return baseTerrain(id,terrain);}
export function disconnectPlayer9(id){return baseDisconnect(id);}
export function rematchRoom9(id,options={}){const result=baseRematch(id,options);if(result.ok){result.room.phase9PickupAttemptTurn=0;for(const p of result.room.players)p.pickupCollectedTurn=-1;normalizeHealLabels(result.room);}return result;}

export const phase9TestHooks=Object.freeze({ensurePhase9,normalizeHealLabels,livingPlayersByX,fairPickupCandidates,repositionNewPickupsFairly,spawnPhase9Pickup,maintainPhase9Pickups,collectOneByTouch,runAdvanceWithoutExplosionCollection});
