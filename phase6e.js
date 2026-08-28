import { randomInt } from 'node:crypto';
import {
  advanceTurnIfDue6D as baseAdvance,
  fireProjectile6D as baseFire,
  jumpActivePlayer6D as baseJump,
  moveActivePlayer6D as baseMove,
  publicRoomState6D as basePublic,
  selectItem6D as baseSelect
} from './phase6d.js';

export const PHASE6E_ITEM_POOL = Object.freeze([
  Object.freeze({ type:'heavy', label:'HEAVY BOMB', weight:25 }),
  Object.freeze({ type:'triple', label:'TRIPLE SHOT', weight:20 }),
  Object.freeze({ type:'cluster', label:'CLUSTER BOMB', weight:20 }),
  Object.freeze({ type:'shield', label:'SHIELD', weight:12 }),
  Object.freeze({ type:'heal', label:'HEAL +30', weight:12 }),
  Object.freeze({ type:'airstrike', label:'AIR STRIKE', weight:8 }),
  Object.freeze({ type:'nuke', label:'NUKE LASER', weight:3 })
]);

export const PHASE6E_POOL_TOTAL = PHASE6E_ITEM_POOL.reduce((sum,item)=>sum+item.weight,0);

export function chooseBalancedItem6E(rawRoll){
  const roll=Number(rawRoll);
  if(!Number.isInteger(roll)||roll<0||roll>=PHASE6E_POOL_TOTAL)throw new RangeError(`roll must be an integer from 0 to ${PHASE6E_POOL_TOTAL-1}`);
  let cursor=roll;
  for(const item of PHASE6E_ITEM_POOL){
    if(cursor<item.weight)return item;
    cursor-=item.weight;
  }
  return PHASE6E_ITEM_POOL[0];
}

function rebalanceNewPickup(room){
  if(!room?.match||!Array.isArray(room.pickups))return false;
  const turn=room.match.turnNumber??0;
  let changed=false;
  for(const box of room.pickups){
    if(box.spawnTurn!==turn||box.phase6ePoolRolled)continue;
    box.phase6ePoolRolled=true;
    const item=chooseBalancedItem6E(randomInt(PHASE6E_POOL_TOTAL));
    if(box.type!==item.type||box.label!==item.label)changed=true;
    box.type=item.type;
    box.label=item.label;
  }
  return changed;
}

function publicState(room){
  let state=basePublic(room);
  if(rebalanceNewPickup(room))state=basePublic(room);
  state.phase='6E';
  state.itemPool=PHASE6E_ITEM_POOL.map(item=>({...item}));
  state.balanceRules={
    poolTotal:PHASE6E_POOL_TOTAL,
    weights:Object.fromEntries(PHASE6E_ITEM_POOL.map(item=>[item.type,item.weight])),
    turnSeconds:40,
    pickupEveryTurns:3,
    pickupLifetimeTurns:4,
    maxPickups:2,
    freeMovement:true,
    jumpCooldownMs:450,
    note:'Phase 6E baseline balance; manual gameplay can still justify later tuning.'
  };
  return state;
}

export function publicRoomState6E(room){return publicState(room);}
export function advanceTurnIfDue6E(code,now=Date.now()){return baseAdvance(code,now);}
export function moveActivePlayer6E(socketId,direction){return baseMove(socketId,direction);}
export function jumpActivePlayer6E(socketId,direction){return baseJump(socketId,direction);}
export function selectItem6E(socketId,slot){return baseSelect(socketId,slot);}
export function fireProjectile6E(socketId){return baseFire(socketId);}
