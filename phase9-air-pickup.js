import { phase7a1TestHooks } from './phase7a1.js';
import {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9 as baseJump,
  moveActivePlayer9 as baseMove,
  phase9TestHooks,
  phase9TraversalTestHooks,
  publicRoomState9,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
} from './phase9-traversal.js';

const GROUND_OFFSET=8;
const SWEEP_STEPS=72;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function motionPoint(motion,t){
  const x=Number(motion.fromX)+(Number(motion.toX)-Number(motion.fromX))*t;
  const linearY=Number(motion.fromY)+(Number(motion.toY)-Number(motion.fromY))*t;
  const apex=Number(motion.apex)||0;
  const y=motion.type==='jump'?linearY-Math.sin(Math.PI*t)*apex:linearY;
  return{x,y};
}

function motionTouchesPickup(motion,box,radius=phase9TestHooks.PICKUP_TOUCH_RADIUS){
  if(!motion||!box||!['jump','fall'].includes(motion.type))return false;
  for(let i=0;i<=SWEEP_STEPS;i+=1){
    const p=motionPoint(motion,i/SWEEP_STEPS);
    if(Math.hypot(p.x-Number(box.x),(p.y-GROUND_OFFSET)-Number(box.y))<=radius)return true;
  }
  return false;
}

function collectOneAlongMotion(room,player,id){
  if(!room?.match||!player?.motion||player.alive===false)return false;
  const turn=room.match.turnNumber??0;
  if(player.pickupCollectedTurn===turn)return false;
  const slot=player.inventory?.findIndex(item=>item==null)??-1;
  if(slot<0)return false;
  let bestIndex=-1,bestProgress=Infinity;
  for(let index=0;index<(room.pickups??[]).length;index+=1){
    const box=room.pickups[index];
    if(!motionTouchesPickup(player.motion,box))continue;
    for(let i=0;i<=SWEEP_STEPS;i+=1){
      const t=i/SWEEP_STEPS,p=motionPoint(player.motion,t);
      if(Math.hypot(p.x-Number(box.x),(p.y-GROUND_OFFSET)-Number(box.y))<=phase9TestHooks.PICKUP_TOUCH_RADIUS){
        if(t<bestProgress){bestProgress=t;bestIndex=index;}
        break;
      }
    }
  }
  if(bestIndex<0)return false;
  const before=phase7a1TestHooks.snapshot(room);
  const [box]=room.pickups.splice(bestIndex,1);
  const label=box.type==='heal'?'HEAL +20':box.label;
  player.inventory[slot]={type:box.type,label,pickedAtTurn:turn};
  player.lastPickup={type:box.type,label,method:'airborne-hitbox-graze',at:Date.now()};
  player.pickupCollectedTurn=turn;
  phase7a1TestHooks.observe(room,before,{actorId:id,sourceId:id,weaponType:'movement'});
  phase9TestHooks.maintainPhase9Pickups(room);
  return true;
}

function collectAfterMotion(result,id){
  if(!result?.ok||!result.room)return result;
  const player=result.room.players?.find(p=>p.id===id);
  if(player?.motion)collectOneAlongMotion(result.room,player,id);
  return result;
}

export function moveActivePlayer9AirPickup(id,direction){return collectAfterMotion(baseMove(id,direction),id);}
export function jumpActivePlayer9AirPickup(id,direction){return collectAfterMotion(baseJump(id,direction),id);}

export const moveActivePlayer9=moveActivePlayer9AirPickup;
export const jumpActivePlayer9=jumpActivePlayer9AirPickup;

export {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  phase9TestHooks,
  phase9TraversalTestHooks,
  publicRoomState9,
  rematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9
};

export const phase9AirPickupTestHooks=Object.freeze({motionPoint,motionTouchesPickup,collectOneAlongMotion,SWEEP_STEPS});
