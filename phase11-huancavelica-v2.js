import { findRoomBySocket, getRoom, createPublicStateView,beginTurn,finishMatch } from './rooms.js';
import {snapshotCombatState,recordCombatEvents} from './phase7a1.js';
import {V2_AIR_PHYSICS,advanceV2AirbornePlayer,setV2AirInput,startV2Airborne,v2GroundSurface,walkV2Player} from './huancavelica-v2-airborne.js';
import { V2_SPAWN_HINTS as SPAWN_IMAGE_HINTS, v2SpawnAtHint as spawnAtHint, isV2Room as isV2, installV2ArenaMetadata } from './huancavelica-v2-state.js';
import { usesV2CombatResolver, advanceV2Combat, prepareV2Weapon } from './huancavelica-v2-combat.js';
import {projectileMuzzle,traceFlight} from './simulation/collision.js';
import {adjustProjectile as adjustSharedProjectile,createV2Attack} from './simulation/projectiles.js';
import {useUtility} from './simulation/rules.js';
import {v2Terrain} from './huancavelica-v2-bitmap.js';
import * as sharedWeapons from './huancavelica-v2-weapons.js';
import {advanceBodies} from './simulation/core.js';
import * as sharedPhysics from './huancavelica-v2-airborne.js';
import {
  advanceTurnIfDue9 as baseAdvance,
  disconnectPlayer9,
  fireProjectile9 as baseFire,
  jumpActivePlayer9 as baseJump,
  moveActivePlayer9 as baseMove,
  phase10HuancavelicaTestHooks,
  phase9AirPickupTestHooks,
  phase9TestHooks,
  phase9TraversalTestHooks,
  publicRoomState9 as basePublic,
  rematchRoom9 as baseRematch,
  selectItem9,
  setAim9 as baseSetAim,
  setTerrain9 as baseSetTerrain
} from './phase10-huancavelica.js';
import {
  HUANCAVELICA_V2_COLLISION_MODEL,
  HUANCAVELICA_V2_ID,
  HUANCAVELICA_V2_IMAGE_HEIGHT,
  HUANCAVELICA_V2_IMAGE_WIDTH,
  HUANCAVELICA_V2_NAME,
  HUANCAVELICA_V2_REVISION,
  HUANCAVELICA_V2_SCALE,
  HUANCAVELICA_V2_WORLD_HEIGHT,
  HUANCAVELICA_V2_WORLD_WIDTH,
  findHuancavelicaV2SurfaceBelow,
  findHuancavelicaV2SurfaceNear,
  firstHuancavelicaV2SolidOnSegment,
  huancavelicaV2LandingHasRun,
  isHuancavelicaV2Solid
} from './huancavelica-v2-bitmap.js';

const COLLISION_BASE='islands';
const LEGACY_HUANCAVELICA_ID='huancavelica';
const WALK_STEP=15;
const MAX_WALK_SURFACE_DELTA=42;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function resultFor(room){
  const alive=room.players.filter(player=>player.alive!==false);
  if(room.mode==='survival'){if(alive.length>1)return null;return{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:alive.length===0};}
  const teams=[...new Set(alive.map(player=>player.team))];if(teams.length>1)return null;return{type:'team',winnerTeam:teams[0]??null,draw:teams.length===0};
}

function validateAction(room,player,id,ignoreMoveMotion=false){
  if(!room)return'not_in_room';if(room.status!=='started')return'match_not_started';if(room.match?.activePlayerId!==id)return'not_your_turn';if(room.match?.projectile)return'shot_in_flight';if(!player?.spawn||player.alive===false)return'player_missing';if(Date.now()>=room.match.turnEndsAt)return'turn_expired';if(player.motion?.endsAt&&Date.now()<Number(player.motion.endsAt)&&!(ignoreMoveMotion&&player.motion.type==='move'))return'player_in_motion';return null;
}

function installV2Arena(room){
  if(!isV2(room)||!room?.arena)return room;
  installV2ArenaMetadata(room);
  snapPickups(room);
  return room;
}

function collectAfterMotion(room,player,id){phase9AirPickupTestHooks.collectOneAlongMotion?.(room,player,id);phase9TestHooks.collectOneByTouch?.(room,player);phase9TestHooks.maintainPhase9Pickups?.(room);snapPickups(room);}

function moveOnV2(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installV2Arena(room);
  const error=validateAction(room,player,id,true);if(error)return{ok:false,error};
  if(player.airborne)return{ok:false,error:'player_airborne'};
  const dir=Number(direction)<0?-1:Number(direction)>0?1:0;if(!dir)return{ok:false,error:'invalid_direction'};
  const result=walkV2Player(room,player,dir,Date.now(),()=>phase9TestHooks.collectOneByTouch?.(room,player));
  if(!result.moved)return{ok:false,error:'terrain_too_steep'};
  collectAfterMotion(room,player,id);return{ok:true,room,naturalDrop:result.naturalDrop??false};
}

function jumpOnV2(id){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installV2Arena(room);
  if(player?.airborne)return{ok:false,error:'already_airborne'};
  const error=validateAction(room,player,id,true);if(error)return{ok:false,error};
  if(v2GroundSurface(room,player.spawn)==null)return{ok:false,error:'not_grounded'};
  startV2Airborne(player,Date.now(),{jump:true,reason:'jump'});return{ok:true,room};
}
export function setAirInput11(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);
  if(!isV2(room))return{ok:false,error:'invalid_terrain'};
  const error=validateAction(room,player,id,true);if(error)return{ok:false,error};
  if(!setV2AirInput(player,direction))return{ok:false,error:'invalid_direction'};
  return{ok:true,room};
}
export function setAim9(id,angle,power){
  const room=findRoomBySocket(id);if(isV2(room)&&room.players.find(p=>p.id===id)?.airborne)return{ok:false,error:'player_airborne'};
  return baseSetAim(id,angle,power);
}

function ensureMuzzleOutside(room,shot){
  if(!shot)return false;const next=projectileMuzzle(shot,(x,y)=>isHuancavelicaV2Solid(room,x,y));
  const changed=next.startX!==shot.startX||next.startY!==shot.startY;Object.assign(shot,next);return changed;
}

function adjustProjectile(room,q){return adjustSharedProjectile(room,q,v2Terrain);}


function settleUnsupported(room){
  let changed=false;
  for(const p of room.players)if(p.alive!==false&&p.spawn&&!p.airborne&&(!p.motion||p.motion.endsAt<=Date.now())&&v2GroundSurface(room,p.spawn)==null)changed=startV2Airborne(p,Date.now(),{reason:'support_loss'})||changed;
  return changed;
}

function safePickupSurface(room,x,y=0){const direct=findHuancavelicaV2SurfaceBelow(room,x,Math.max(0,y),HUANCAVELICA_V2_WORLD_HEIGHT-y);if(direct!=null&&huancavelicaV2LandingHasRun(room,x,direct,18,85))return{x,surface:direct};for(let radius=15;radius<=240;radius+=15)for(const candidate of[x-radius,x+radius]){const surface=findHuancavelicaV2SurfaceBelow(room,candidate,0,HUANCAVELICA_V2_WORLD_HEIGHT);if(surface!=null&&huancavelicaV2LandingHasRun(room,candidate,surface,18,85))return{x:candidate,surface};}return null;}
function snapPickups(room){if(!isV2(room))return;room.pickups=(room.pickups??[]).filter(box=>{const support=safePickupSurface(room,Number(box.x),Math.max(0,Number(box.y??0)));if(!support)return false;box.x=Math.round(support.x);box.y=Math.round(support.surface-24);return true;});}

function fireOnV2(id){
  const room=findRoomBySocket(id);installV2Arena(room);
  if(room?.players.find(p=>p.id===id)?.airborne)return{ok:false,error:'player_airborne'};
  const player=room?.players.find(p=>p.id===id),item=player?.inventory?.[(player.selectedItemSlot??1)-2];
  if(['heal','shield'].includes(item?.type)){
    const error=validateAction(room,player,id);if(error)return{ok:false,error};
    const before=snapshotCombatState(room),used=useUtility(player,Date.now(),room.match.turnNumber);
    if(used.ok)recordCombatEvents(room,before,{actorId:id,sourceId:id});
    return{...used,room};
  }
  const result=baseFire(id);
  if(result?.ok&&isV2(result.room)){
    installV2Arena(result.room);
    const q=result.room.match?.projectile;
    if(q){
      // Reconcile every designator with the shared collision contract before
      // the Session02 impact resolver constructs its definitive events.
      Object.assign(q,createV2Attack(result.room,player,{id:q.id,startedAt:q.startedAt,weaponType:q.weaponType??'basic'},v2Terrain,sharedWeapons));
    }
  }
  return result;
}
function advanceOnV2(code,now=Date.now()){
  const room=getRoom(code);if(!isV2(room))return baseAdvance(code,now);if(room.status!=='started')return null;installV2Arena(room);
  const activeBefore=room.match.activePlayerId,before=snapshotCombatState(room),q=room.match.projectile;
  let changed=advanceBodies(room,now,sharedPhysics,p=>phase9TestHooks.collectOneByTouch?.(room,p));
  recordCombatEvents(room,before,{sourceId:q?.ownerPlayerId??null,weaponType:q?.weaponType??'movement'});
  let result=null;
  if(usesV2CombatResolver(q))result=advanceV2Combat(room,now);
  else if(!q&&!room.players.some(p=>p.alive!==false&&p.airborne)){
    const winner=resultFor(room);
    if(winner)result=finishMatch(room,winner,now);
    else if(now>=room.match.turnEndsAt)result=beginTurn(room,room.match.turnIndex+1,now);
  }
  if(room.status!=='started'||activeBefore!==room.match.activePlayerId)for(const p of room.players){p.v2HorizontalInput=0;if(p.airborne)p.airborne.input=0;}
  phase9TestHooks.maintainPhase9Pickups?.(room);snapPickups(room);
  return result??(changed?room:null);
}

function decoratePublic(room,state){
  const presets=(state?.terrainPresets??[]).filter(entry=>entry.id!==LEGACY_HUANCAVELICA_ID);if(!presets.some(entry=>entry.id===HUANCAVELICA_V2_ID))presets.push({id:HUANCAVELICA_V2_ID,name:HUANCAVELICA_V2_NAME,terrainRevision:HUANCAVELICA_V2_REVISION});state.terrainPresets=presets;
  if(isV2(room)){installV2Arena(room);state=basePublic(room);state.terrainPresets=presets;state.terrainPreset=HUANCAVELICA_V2_ID;state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_V2_ID,terrainName:HUANCAVELICA_V2_NAME,phase11Theme:HUANCAVELICA_V2_ID,terrainRevision:HUANCAVELICA_V2_REVISION,collisionModel:HUANCAVELICA_V2_COLLISION_MODEL,platforms:[],worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,bitmapTerrain:{width:HUANCAVELICA_V2_IMAGE_WIDTH,height:HUANCAVELICA_V2_IMAGE_HEIGHT,worldWidth:HUANCAVELICA_V2_WORLD_WIDTH,worldHeight:HUANCAVELICA_V2_WORLD_HEIGHT,uniformScale:HUANCAVELICA_V2_SCALE,maskSource:'cleaned-terrain-alpha-guided-by-supplied-mask'}};state.players=state.players.map(p=>({...p,airborne:room.players.find(source=>source.id===p.id)?.airborne?{...room.players.find(source=>source.id===p.id).airborne}:null}));state.phase11Map={id:HUANCAVELICA_V2_ID,name:HUANCAVELICA_V2_NAME,terrainRevision:HUANCAVELICA_V2_REVISION,collisionModel:HUANCAVELICA_V2_COLLISION_MODEL,oneIslandOnePlayableSurface:true,oldPlatformGraphAuthority:false,normalMovementStep:WALK_STEP,normalWalkableSurfaceDelta:MAX_WALK_SURFACE_DELTA,normalJumpDistance:null,adaptiveMaxDistance:null,airPhysics:V2_AIR_PHYSICS,productionReady:true};}
  return state;
}

export function publicRoomState11(room){
  if(!isV2(room))return decoratePublic(room,basePublic(room));
  const view=createPublicStateView(room);
  installV2Arena(view);
  return decoratePublic(view,basePublic(view));
}
export function setTerrain11(id,terrain){const requested=typeof terrain==='string'?terrain.toLowerCase():null;if(!requested||requested===LEGACY_HUANCAVELICA_ID)return{ok:false,error:'invalid_terrain'};const v2=requested===HUANCAVELICA_V2_ID,result=baseSetTerrain(id,v2?COLLISION_BASE:requested);if(!result.ok)return result;result.room.phase11TerrainAlias=v2?HUANCAVELICA_V2_ID:null;result.room.phase11TerrainRevision=v2?HUANCAVELICA_V2_REVISION:null;result.room.phase11SpawnKey=null;for(const player of result.room.players??[])player.ready=false;if(v2)installV2Arena(result.room);return result;}
export function moveActivePlayer11(id,direction){const room=findRoomBySocket(id);return isV2(room)?moveOnV2(id,direction):baseMove(id,direction);}
export function jumpActivePlayer11(id,direction){const room=findRoomBySocket(id);return isV2(room)?jumpOnV2(id,direction):baseJump(id,direction);}
export function fireProjectile11(id){const room=findRoomBySocket(id);return isV2(room)?fireOnV2(id):baseFire(id);}
export function advanceTurnIfDue11(code,now=Date.now()){return advanceOnV2(code,now);}
export function rematchRoom11(id,options={}){
  const room=findRoomBySocket(id),keepV2=isV2(room)&&!options?.randomMap;
  const oldAlias=room?.phase11TerrainAlias;
  // A random rematch initializes its selected legacy map, not the previous v2.
  const clearAlias=Boolean(room&&isV2(room)&&options?.randomMap&&room.hostId===id&&room.status==='finished');
  if(clearAlias)room.phase11TerrainAlias=null;
  const result=baseRematch(id,options);
  if(!result?.ok){if(clearAlias)room.phase11TerrainAlias=oldAlias;return result;}
  result.room.phase11TerrainAlias=keepV2?HUANCAVELICA_V2_ID:null;
  result.room.phase11TerrainRevision=keepV2?HUANCAVELICA_V2_REVISION:null;
  if(keepV2)installV2Arena(result.room);
  return result;
}

export const publicRoomState9=publicRoomState11;
export const setTerrain9=setTerrain11;
export const moveActivePlayer9=moveActivePlayer11;
export const jumpActivePlayer9=jumpActivePlayer11;
export const fireProjectile9=fireProjectile11;
export const advanceTurnIfDue9=advanceTurnIfDue11;
export const rematchRoom9=rematchRoom11;
export {disconnectPlayer9,phase10HuancavelicaTestHooks,phase9AirPickupTestHooks,phase9TestHooks,phase9TraversalTestHooks,selectItem9};
export const phase11HuancavelicaV2TestHooks=Object.freeze({SPAWN_IMAGE_HINTS,isV2,installV2Arena,spawnAtHint,moveOnV2,jumpOnV2,ensureMuzzleOutside,adjustProjectile,settleUnsupported,safePickupSurface});
