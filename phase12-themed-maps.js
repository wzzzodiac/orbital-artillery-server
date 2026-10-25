// Production adapter for the two approved maps. Huancavelica continues through
// its existing adapter, while all three share the same bitmap physics factories.
import * as previous from './phase11-huancavelica-v2.js';
import {findRoomBySocket,getRoom,createPublicStateView,startRoom as baseStart,beginTurn,finishMatch,resultFor} from './rooms.js';
import {snapshotCombatState,recordCombatEvents} from './phase7a1.js';
import {createAirbornePhysics} from './simulation/airborne.js';
import {createWeaponRules} from './simulation/weapons.js';
import {createCombatResolver} from './simulation/combat.js';
import {advanceBodies} from './simulation/core.js';
import {createV2Attack} from './simulation/projectiles.js';
import {THEMED_BITMAP_MAPS,themedTerrains,themedMapFor,isThemedBitmapRoom,themedArenaMetadata} from './themed-bitmap.js';
const runtimes=Object.fromEntries(Object.entries(themedTerrains).map(([id,terrain])=>{
 const physics=createAirbornePhysics(terrain),weapons=createWeaponRules(terrain);
 return [id,{terrain,physics,weapons,combat:createCombatResolver({terrain,physics,weapons,policy:{beginTurn,finishMatch,resultFor,snapshotCombatState,recordCombatEvents}})}];
}));
const runtime=room=>isThemedBitmapRoom(room)?runtimes[themedMapFor(room).id]:null;
function validate(room,id){const p=room?.players.find(p=>p.id===id);return !room?'not_in_room':room.status!=='started'?'match_not_started':room.match.activePlayerId!==id?'not_your_turn':room.match.projectile?'shot_in_flight':!p?.spawn||p.alive===false?'player_missing':Date.now()>=room.match.turnEndsAt?'turn_expired':null;}
function snapPickups(room){
 const r=runtime(room);if(!r)return;
 room.pickups=(room.pickups??[]).filter(box=>{
  const y=r.terrain.findHuancavelicaV2SurfaceBelow(room,box.x,Math.max(0,(box.y??0)-40),5000);
  if(y==null)return false;box.y=y-24;return true;
 });
}
export function startRoom(id){
 const room=findRoomBySocket(id),old=room?.bitmapMapsEnabled;
 if(room)room.bitmapMapsEnabled=true;
 const result=baseStart(id);if(!result.ok&&room){if(old===undefined)delete room.bitmapMapsEnabled;else room.bitmapMapsEnabled=old;}
 return result;
}
export function setTerrain9(id,map){const result=previous.setTerrain9(id,map);if(result.ok)result.room.bitmapMapsEnabled=true;return result;}
export function publicRoomState9(room){
 const config=themedMapFor(room);if(!config||(!isThemedBitmapRoom(room)&&room.status!=='lobby'))return previous.publicRoomState9(room);
 const view=createPublicStateView(room),state=previous.publicRoomState9(view);
 state.arena={...state.arena,...themedArenaMetadata(config)};
 state.players=state.players.map(p=>({...p,airborne:view.players.find(v=>v.id===p.id)?.airborne??null}));
 state.terrainPresets=state.terrainPresets.map(p=>THEMED_BITMAP_MAPS[p.id]?{...p,terrainRevision:THEMED_BITMAP_MAPS[p.id].revision}:p);
 state.bitmapMap={id:config.id,revision:config.revision,collisionModel:'bitmap-terrain-mask-v2'};
 return state;
}
export function moveActivePlayer9(id,direction){
 const room=findRoomBySocket(id),r=runtime(room);if(!r)return previous.moveActivePlayer9(id,direction);
 const error=validate(room,id);if(error)return{ok:false,error};if(![-1,1].includes(direction))return{ok:false,error:'invalid_direction'};
 const p=room.players.find(p=>p.id===id);if(p.airborne)return{ok:false,error:'player_airborne'};
 const result=r.physics.walkV2Player(room,p,direction,Date.now(),()=>previous.phase9TestHooks.collectOneByTouch(room,p));
 return result.moved?{ok:true,room,naturalDrop:result.naturalDrop??false}:{ok:false,error:'terrain_too_steep'};
}
export function jumpActivePlayer9(id){
 const room=findRoomBySocket(id),r=runtime(room);if(!r)return previous.jumpActivePlayer9(id);
 const error=validate(room,id);if(error)return{ok:false,error};const p=room.players.find(p=>p.id===id);
 if(p.airborne)return{ok:false,error:'already_airborne'};if(r.physics.v2GroundSurface(room,p.spawn)==null)return{ok:false,error:'not_grounded'};
 r.physics.startV2Airborne(p,Date.now(),{jump:true,reason:'jump'});return{ok:true,room};
}
export function setAirInput11(id,direction){
 const room=findRoomBySocket(id),r=runtime(room);if(!r)return previous.setAirInput11(id,direction);
 const error=validate(room,id);if(error)return{ok:false,error};
 return r.physics.setV2AirInput(room.players.find(p=>p.id===id),direction)?{ok:true,room}:{ok:false,error:'invalid_direction'};
}
export function setAim9(id,angle,power){const room=findRoomBySocket(id);if(runtime(room)&&room.players.find(p=>p.id===id)?.airborne)return{ok:false,error:'player_airborne'};return previous.setAim9(id,angle,power);}
export function fireProjectile9(id){
 const room=findRoomBySocket(id),r=runtime(room);if(!r)return previous.fireProjectile9(id);
 const error=validate(room,id);if(error)return{ok:false,error};const player=room.players.find(p=>p.id===id);if(player.airborne)return{ok:false,error:'player_airborne'};
 // Keep accepted inventory, telemetry and utility handling; replace only the
 // legacy forecast before it can be resolved or sent to a client.
 const result=previous.fireProjectile9(id),q=room.match.projectile;
 if(result.ok&&q){Object.assign(q,createV2Attack(room,player,{id:q.id,startedAt:q.startedAt,weaponType:q.weaponType??'basic'},r.terrain,r.weapons));snapPickups(room);}
 return result;
}
export function advanceTurnIfDue9(code,now=Date.now()){
 const room=getRoom(code),r=runtime(room);if(!r)return previous.advanceTurnIfDue9(code,now);if(room.status!=='started')return null;
 const activeBefore=room.match.activePlayerId,before=snapshotCombatState(room),q=room.match.projectile;
 let changed=advanceBodies(room,now,r.physics,p=>previous.phase9TestHooks.collectOneByTouch(room,p));
 recordCombatEvents(room,before,{sourceId:q?.ownerPlayerId??null,weaponType:q?.weaponType??'movement'});
 let result=null;
 if(r.combat.usesV2CombatResolver(q))result=r.combat.advanceV2Combat(room,now);
 else if(!q&&!room.players.some(p=>p.alive!==false&&p.airborne)){
  const winner=resultFor(room);if(winner)result=finishMatch(room,winner,now);else if(now>=room.match.turnEndsAt)result=beginTurn(room,room.match.turnIndex+1,now);
 }
 if(room.status!=='started'||room.match.activePlayerId!==activeBefore)for(const p of room.players){p.v2HorizontalInput=0;if(p.airborne)p.airborne.input=0;}
 previous.phase9TestHooks.maintainPhase9Pickups(room);snapPickups(room);
 return result??(changed?room:null);
}
export function rematchRoom9(id,options){const room=findRoomBySocket(id),old=room?.bitmapMapsEnabled;if(room?.hostId===id&&room.status==='finished')room.bitmapMapsEnabled=true;const result=previous.rematchRoom9(id,options);if(!result.ok&&room){if(old===undefined)delete room.bitmapMapsEnabled;else room.bitmapMapsEnabled=old;}return result;}
export const {disconnectPlayer9,selectItem9}=previous;
export const themedBitmapTestHooks=Object.freeze({runtimes,snapPickups});
