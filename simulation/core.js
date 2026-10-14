import {createBitmapTerrain,HUANCAVELICA_V2_WORLD_HEIGHT as height} from './terrain.js';
import {createAirbornePhysics} from './airborne.js';
import {createWeaponRules} from './weapons.js';
import {createCombatResolver} from './combat.js';
import {createV2Attack} from './projectiles.js';
import {collectOneByTouch,useUtility,nextEventId,seededRandom,chooseItem} from './rules.js';
const clone=value=>structuredClone(value);
export function resultFor(room){
 const alive=room.players.filter(p=>p.alive!==false&&!p.dummy);
 if(room.practice)return null;
 if(room.mode==='survival')return alive.length>1?null:{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:!alive.length};
 const teams=[...new Set(alive.map(p=>p.team))];return teams.length>1?null:{type:'team',winnerTeam:teams[0]??null,draw:!teams.length};
}
export function simulationPolicy({practice=false}={}){
 return {
 resultFor:room=>practice?null:resultFor(room),
 snapshotCombatState:room=>room.players.map(p=>({id:p.id,hp:p.hp,alive:p.alive})),
 recordCombatEvents(room,before,context={}){
  room.simulation??={seed:1,eventSequence:0};room.events??=[];
  for(const p of room.players){const old=before?.find(x=>x.id===p.id);if(!old)continue;
   const damage=Math.max(0,(old.hp??100)-(p.hp??100));if(damage||old.alive!==p.alive)room.events.push({id:nextEventId(room.simulation,'combat'),at:p.lastDamage?.at??room.simulation.now,playerId:p.id,damage,alive:p.alive,...context});
  }if(room.events.length>36)room.events.splice(0,room.events.length-36);
 },
 finishMatch(room,result,now){room.status='finished';room.match.result=result;room.match.finishedAt=now;room.match.projectile=null;return room;},
 beginTurn(room,index,now){
  const m=room.match;
  if(!practice){const order=m.turnOrder.filter(id=>room.players.some(p=>p.id===id&&p.alive!==false&&!p.dummy));m.turnOrder=order;m.turnIndex=index%Math.max(1,order.length);m.activePlayerId=order[m.turnIndex]??null;m.turnNumber++;m.aimAngle=45;m.aimPower=55;}
  m.projectile=null;m.pendingResult=null;m.turnEndsAt=practice?Number.MAX_SAFE_INTEGER:now+(m.turnDurationMs??40000);m.turnStartedAt=now;
  room.camera={mode:'follow',targetPlayerId:m.activePlayerId};return room;
 }
 };
}
export function advanceBodies(room,now,physics,onStep=()=>{}){
 let changed=false;const m=room.match;
 for(const p of room.players){
  if(p.alive===false||!p.spawn||p.dummy)continue;
  if(p.id!==m.activePlayerId||m.projectile||now>=m.turnEndsAt){p.v2HorizontalInput=0;if(p.airborne)p.airborne.input=0;}
  if(!p.airborne&&(!p.motion||p.motion.endsAt<=now)&&physics.v2GroundSurface(room,p.spawn)==null)changed=physics.startV2Airborne(p,now,{reason:'support_loss'})||changed;
  changed=physics.advanceV2AirbornePlayer(room,p,now,()=>onStep(p))||changed;
 }return changed;
}
export function createGameplayCore(mask,{practice=false,policy:injectedPolicy}={}){
 const terrain=createBitmapTerrain(mask),physics=createAirbornePhysics(terrain),weapons=createWeaponRules(terrain),policy=injectedPolicy??simulationPolicy({practice});
 const combat=createCombatResolver({terrain,physics,weapons,policy});
 function command(room,id,event,payload={},now){
  if(!Number.isFinite(now))return{ok:false,error:'invalid_clock'};
  const p=room.players.find(x=>x.id===id),m=room.match;
  let error=room.status!=='started'?'match_not_started':m.activePlayerId!==id?'not_your_turn':m.projectile?'shot_in_flight':!p?.spawn||p.alive===false||p.dummy?'player_missing':now>=m.turnEndsAt?'turn_expired':null;
  if(error)return{ok:false,error};
  if(event==='air_input')return{ok:physics.setV2AirInput(p,payload.direction),error:[-1,0,1].includes(payload.direction)?undefined:'invalid_direction'};
  if(event==='select_item'){if(![1,2,3].includes(payload.slot))return{ok:false,error:'invalid_item_slot'};if(payload.slot>1&&!p.inventory?.[payload.slot-2])return{ok:false,error:'empty_item_slot'};p.selectedItemSlot=payload.slot;return{ok:true};}
  if(p.airborne)return{ok:false,error:event==='jump_player'?'already_airborne':'player_airborne'};
  if(event==='move_player'){
   if(![-1,1].includes(payload.direction))return{ok:false,error:'invalid_direction'};
   return{ok:physics.walkV2Player(room,p,payload.direction,now,()=>collectOneByTouch(room,p,now,{perTurn:!practice})).moved};
  }
  if(event==='jump_player'){if(physics.v2GroundSurface(room,p.spawn)==null)return{ok:false,error:'not_grounded'};physics.startV2Airborne(p,now,{jump:true,reason:'jump'});return{ok:true};}
  if(event==='set_aim'){if(![payload.angle,payload.power].every(Number.isFinite))return{ok:false,error:'invalid_aim'};m.aimAngle=Math.max(5,Math.min(85,payload.angle));m.aimPower=Math.max(10,Math.min(100,payload.power));return{ok:true};}
  if(event!=='fire_projectile')return{ok:false,error:'invalid_command'};
  const used=useUtility(p,now,m.turnNumber);if(used)return used;
  const slot=p.selectedItemSlot??1,item=slot>1?p.inventory?.[slot-2]:null;
  if(slot>1&&!item)return{ok:false,error:'empty_item_slot'};
  room.simulation??={seed:1,eventSequence:0};
  const weaponType=item?.type??'basic',idAttack=nextEventId(room.simulation,'attack');
  m.projectile=createV2Attack(room,p,{id:idAttack,startedAt:now+(weaponType==='airstrike'?0:567),weaponType},terrain,weapons);
  if(item){p.inventory[slot-2]=null;p.selectedItemSlot=1;}return{ok:true};
 }
 function tick(room,now){
  if(room.status!=='started'||!Number.isFinite(now))return room;
  room.simulation??={seed:1,eventSequence:0};room.simulation.now=now;
  const before=policy.snapshotCombatState(room),q=room.match.projectile;
  advanceBodies(room,now,physics,p=>collectOneByTouch(room,p,now,{perTurn:!practice}));
  for(const p of room.players)collectOneByTouch(room,p,now,{perTurn:!practice});
  policy.recordCombatEvents(room,before,{sourceId:q?.ownerPlayerId??null,weaponType:q?.weaponType??'movement'});
  if(q)combat.advanceV2Combat(room,now);
  else if(!room.players.some(p=>p.alive!==false&&p.airborne)){
   const result=policy.resultFor(room);if(result)policy.finishMatch(room,result,now);else if(now>=room.match.turnEndsAt)policy.beginTurn(room,room.match.turnIndex+1,now);
  }return room;
 }
 function spawnPickup(room,points,now,max=4){
  if((room.pickups??=[]).length>=max||!points.length)return null;
  room.simulation??={seed:1,eventSequence:0};const state=room.simulation,point=points[Math.floor(seededRandom(state)*points.length)];
  const y=terrain.findHuancavelicaV2SurfaceBelow(room,point.x,point.y??0);if(y==null)return null;
  if(room.pickups.some(p=>Math.hypot(p.x-point.x,p.y-(y-24))<95))return null;
  const item=chooseItem(Math.floor(seededRandom(state)*100)),box={...item,id:nextEventId(state,'pickup'),x:point.x,y:y-24,createdAt:now,spawnTurn:room.match.turnNumber};
  room.pickups.push(box);return box;
 }
 return Object.freeze({terrain,physics,weapons,combat,command,tick,spawnPickup,snapshot:clone});
}
