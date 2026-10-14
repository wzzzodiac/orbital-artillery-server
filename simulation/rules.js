// Accepted v0.9 balance. Runtime-independent data; do not retune during extraction.
export const V09_BALLISTIC_BALANCE=Object.freeze({
 basic:Object.freeze({damage:10,radius:260,craterRadius:135,craterDepth:165}),
 heavy:Object.freeze({damage:20,radius:320,craterRadius:190,craterDepth:90}),shieldFactor:.5
});
export const COMBAT_MOTION_RULES=Object.freeze({gravity:520,dt:.02,maxSeconds:2.4,minStrength:.10,maxSpeed:520,liftBias:115,radius:260,groundOffset:8,fallMs:2200,finishBufferMs:250});
export const ITEM_POOL=Object.freeze([
 {type:'heavy',label:'HEAVY BOMB',weight:25},{type:'triple',label:'TRIPLE SHOT',weight:20},
 {type:'cluster',label:'CLUSTER BOMB',weight:20},{type:'shield',label:'SHIELD',weight:12},
 {type:'heal',label:'HEAL +20',weight:12},{type:'airstrike',label:'AIR STRIKE',weight:8},{type:'nuke',label:'NUKE LASER',weight:3}
].map(Object.freeze));
export function chooseItem(roll){if(!Number.isInteger(roll)||roll<0||roll>=100)throw new RangeError('roll must be an integer from 0 to 99');for(const item of ITEM_POOL){if(roll<item.weight)return item;roll-=item.weight;}}
export function seededRandom(state){let x=(state.seed??1)>>>0;x=(x+0x6d2b79f5)>>>0;state.seed=x;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;}
export function nextEventId(state,prefix='event'){state.eventSequence=(state.eventSequence??0)+1;return prefix+':'+state.eventSequence;}
export function collectOneByTouch(room,player,now,{perTurn=true}={}){
 if(!player?.spawn||player.alive===false||player.dummy)return false;
 player.inventory??=[null,null];const turn=room.match?.turnNumber??0;
 if(perTurn&&player.pickupCollectedTurn===turn)return false;const slot=player.inventory.findIndex(x=>x==null);if(slot<0)return false;
 let best=-1,distance=Infinity;for(let i=0;i<(room.pickups??[]).length;i++){const b=room.pickups[i],d=Math.hypot(player.spawn.x-b.x,player.spawn.y-8-b.y);if(d<=74&&d<distance){best=i;distance=d;}}
 if(best<0)return false;const [box]=room.pickups.splice(best,1),label=box.type==='heal'?'HEAL +20':box.label;
 player.inventory[slot]={type:box.type,label,pickedAtTurn:turn};player.lastPickup={type:box.type,label,method:'touch',at:now};player.pickupCollectedTurn=turn;return true;
}
export function useUtility(player,now,turn){
 const slot=player.selectedItemSlot??1,item=slot>1?player.inventory?.[slot-2]:null;
 if(!['heal','shield'].includes(item?.type))return null;
 if(item.type==='heal'&&(player.hp??100)>=100)return{ok:false,error:'heal_full_hp'};
 if(item.type==='heal'){const before=player.hp??100;player.hp=Math.min(100,before+20);player.lastUtility={type:'heal',label:'HEAL +'+(player.hp-before)+' HP',amount:player.hp-before,at:now};}
 else{player.shield={factor:.5,activatedAt:now,activatedTurn:turn};player.lastUtility={type:'shield',label:'SHIELD ACTIVATED',at:now};}
 player.inventory[slot-2]=null;player.selectedItemSlot=1;return{ok:true,healed:player.lastUtility.amount};
}
