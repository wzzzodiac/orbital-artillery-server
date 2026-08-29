import { findRoomBySocket } from './rooms.js';
import {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9,
  moveActivePlayer9,
  phase9AirPickupTestHooks,
  phase9TestHooks,
  phase9TraversalTestHooks,
  publicRoomState9 as basePublicRoomState9,
  rematchRoom9 as baseRematchRoom9,
  selectItem9,
  setAim9,
  setTerrain9 as baseSetTerrain9
} from './phase9-air-pickup.js';

const HUANCAVELICA_ID='huancavelica';
const HUANCAVELICA_NAME='Huancavelica Simulator';
const COLLISION_BASE='islands';

function decoratePublicState(room,state){
  const presets=[...(state?.terrainPresets??[])];
  if(!presets.some(entry=>entry.id===HUANCAVELICA_ID))presets.push({id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME});
  state.terrainPresets=presets;
  if(room?.phase10TerrainAlias===HUANCAVELICA_ID){
    state.terrainPreset=HUANCAVELICA_ID;
    state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_ID,terrainName:HUANCAVELICA_NAME,phase10Theme:HUANCAVELICA_ID,collisionBasePreset:COLLISION_BASE};
    state.phase10Map={id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME,visualTheme:'bright-alpine-void',collisionBasePreset:COLLISION_BASE,experimental:true};
  }
  return state;
}

export function publicRoomState9(room){return decoratePublicState(room,basePublicRoomState9(room));}

export function setTerrain9(id,terrain){
  const requested=String(terrain??'').toLowerCase();
  if(requested===HUANCAVELICA_ID){
    const result=baseSetTerrain9(id,COLLISION_BASE);
    if(result?.ok){result.room.phase10TerrainAlias=HUANCAVELICA_ID;for(const player of result.room.players??[])player.ready=false;}
    return result;
  }
  const room=findRoomBySocket(id),hadAlias=room?.phase10TerrainAlias===HUANCAVELICA_ID;
  if(room)room.phase10TerrainAlias=null;
  const result=baseSetTerrain9(id,requested);
  if(result?.ok&&hadAlias)for(const player of result.room.players??[])player.ready=false;
  return result;
}

export function rematchRoom9(id,options={}){
  const room=findRoomBySocket(id),keepAlias=room?.phase10TerrainAlias===HUANCAVELICA_ID&&!options?.randomMap;
  const result=baseRematchRoom9(id,options);
  if(result?.ok)result.room.phase10TerrainAlias=keepAlias?HUANCAVELICA_ID:null;
  return result;
}

export {
  advanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9,
  jumpActivePlayer9,
  moveActivePlayer9,
  phase9AirPickupTestHooks,
  phase9TestHooks,
  phase9TraversalTestHooks,
  selectItem9,
  setAim9
};

export const phase10HuancavelicaTestHooks=Object.freeze({HUANCAVELICA_ID,HUANCAVELICA_NAME,COLLISION_BASE,decoratePublicState});
