import { randomInt } from 'node:crypto';
import { findRoomBySocket, getRoom, setAim, setTerrainPreset, startRoom } from './rooms.js';
import {
  advanceTurnIfDue6E as baseAdvance,
  fireProjectile6E as baseFire,
  jumpActivePlayer6E as baseJump,
  moveActivePlayer6E as baseMove,
  publicRoomState6E as basePublic,
  selectItem6E as baseSelect
} from './phase6e.js';

const TERRAIN_IDS=['rolling','terraces','twinpeaks','basin','brokenridge','islands','canyon'];
const EVENT_LIMIT=36;
const blankStats=()=>({damageDealt:0,damageReceived:0,kills:0,assists:0,deaths:0,selfKOs:0,voidDeaths:0,pickups:0,biggestHit:0,shotsFired:0,weaponUses:{}});

function ensureTelemetry(room){
  if(!room)return room;
  if(!room.matchTelemetry||room.matchTelemetry.matchStartedAt!==room.startedAt){room.matchTelemetry={matchStartedAt:room.startedAt??null,stats:{},contributors:{},events:[],deathAttribution:{}};}
  for(const p of room.players)if(!room.matchTelemetry.stats[p.id])room.matchTelemetry.stats[p.id]=blankStats();
  return room.matchTelemetry;
}
function pushEvent(room,type,text,data={}){const t=ensureTelemetry(room);t.events.push({id:`${Date.now()}-${t.events.length}`,at:Date.now(),turn:room.match?.turnNumber??0,type,text,...data});if(t.events.length>EVENT_LIMIT)t.events.splice(0,t.events.length-EVENT_LIMIT);}
function nameOf(room,id){return room.players.find(p=>p.id===id)?.name??'PLAYER';}
function snapshot(room){if(!room)return null;return{projectile:room.match?.projectile?{ownerPlayerId:room.match.projectile.ownerPlayerId,weaponType:room.match.projectile.weaponType??'basic'}:null,players:Object.fromEntries(room.players.map(p=>[p.id,{hp:p.hp??100,alive:p.alive!==false,lastPickupAt:p.lastPickup?.at??null,lastPickupType:p.lastPickup?.type??null,lastUtilityAt:p.lastUtility?.at??null,lastUtilityType:p.lastUtility?.type??null}]))};}
function recordDamage(room,before,after,sourceId,weaponType){
  const t=ensureTelemetry(room);
  for(const p of room.players){
    const b=before?.players?.[p.id],a=after?.players?.[p.id];if(!b||!a)continue;const dropped=Math.max(0,(b.hp??100)-(a.hp??100));const voided=a.alive===false&&(p.spawn?.y>5000||Number(p.motion?.toY)>5000);
    if(dropped>0&&!voided){t.stats[p.id].damageReceived+=dropped;if(sourceId&&t.stats[sourceId]){if(sourceId!==p.id){t.stats[sourceId].damageDealt+=dropped;t.stats[sourceId].biggestHit=Math.max(t.stats[sourceId].biggestHit,dropped);t.contributors[p.id]??={};t.contributors[p.id][sourceId]=(t.contributors[p.id][sourceId]??0)+dropped;pushEvent(room,'damage',`${nameOf(room,sourceId)} dealt ${dropped} damage to ${p.name}.`,{sourcePlayerId:sourceId,targetPlayerId:p.id,amount:dropped,weaponType});}else pushEvent(room,'self_damage',`${p.name} took ${dropped} self-damage.`,{sourcePlayerId:sourceId,targetPlayerId:p.id,amount:dropped,weaponType});}}
    if(b.alive!==false&&a.alive===false&&!t.deathAttribution[p.id]){const cause=voided?(sourceId&&sourceId!==p.id?'terrain_collapse':'void'):(sourceId===p.id?'self_ko':sourceId?'player':'environment');t.deathAttribution[p.id]={cause,sourcePlayerId:sourceId??null,at:Date.now(),weaponType:weaponType??null};t.stats[p.id].deaths+=1;if(cause==='void'||cause==='terrain_collapse')t.stats[p.id].voidDeaths+=1;if(cause==='self_ko'||(cause==='void'&&sourceId===p.id))t.stats[p.id].selfKOs+=1;if(sourceId&&sourceId!==p.id&&t.stats[sourceId]){t.stats[sourceId].kills+=1;const contributors=Object.keys(t.contributors[p.id]??{}).filter(id=>id!==sourceId&&id!==p.id&&t.stats[id]);for(const id of contributors)t.stats[id].assists+=1;}const causeText=cause==='terrain_collapse'?'fell after terrain collapse':cause==='void'?'fell into the void':cause==='self_ko'?'self-destructed':sourceId?`was eliminated by ${nameOf(room,sourceId)}`:'was eliminated';pushEvent(room,'death',`${p.name} ${causeText}.`,{targetPlayerId:p.id,sourcePlayerId:sourceId??null,cause,weaponType});}
  }
}
function recordPickupsAndUtilities(room,before,after){const t=ensureTelemetry(room);for(const p of room.players){const b=before?.players?.[p.id],a=after?.players?.[p.id];if(!b||!a)continue;if(a.lastPickupAt&&a.lastPickupAt!==b.lastPickupAt){t.stats[p.id].pickups+=1;pushEvent(room,'pickup',`${p.name} picked up ${(p.lastPickup?.label??a.lastPickupType??'pickup')}.`,{playerId:p.id,itemType:a.lastPickupType});}if(a.lastUtilityAt&&a.lastUtilityAt!==b.lastUtilityAt){const label=p.lastUtility?.label??String(a.lastUtilityType??'utility').toUpperCase();pushEvent(room,'utility',`${p.name}: ${label}.`,{playerId:p.id,utilityType:a.lastUtilityType});}}}
function observe(room,before,{actorId=null,sourceId=null,weaponType=null}={}){if(!room||!before)return room;const after=snapshot(room),source=sourceId??before.projectile?.ownerPlayerId??actorId??null,weapon=weaponType??before.projectile?.weaponType??null;recordDamage(room,before,after,source,weapon);recordPickupsAndUtilities(room,before,after);return room;}
function publicStats(room){const t=ensureTelemetry(room);return room.players.map(p=>{const stats=t.stats[p.id]??blankStats();return{playerId:p.id,name:p.name,team:p.team,...blankStats(),...stats,weaponUses:{...(stats.weaponUses??{})}};});}
function summary(room){
  if(room.status!=='finished')return null;const stats=publicStats(room),topDamage=[...stats].sort((a,b)=>b.damageDealt-a.damageDealt)[0]??null,topKills=[...stats].sort((a,b)=>b.kills-a.kills||b.damageDealt-a.damageDealt)[0]??null,weaponTotals={};
  for(const s of stats)for(const [weapon,count] of Object.entries(s.weaponUses??{}))weaponTotals[weapon]=(weaponTotals[weapon]??0)+count;
  const mostUsedWeapon=Object.entries(weaponTotals).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]??null;
  return{durationMs:Math.max(0,(room.match?.finishedAt??Date.now())-(room.match?.activatedAt??room.startedAt??Date.now())),turns:room.match?.turnNumber??0,result:room.match?.result??null,topDamage:topDamage?{playerId:topDamage.playerId,name:topDamage.name,value:topDamage.damageDealt}:null,topKills:topKills?{playerId:topKills.playerId,name:topKills.name,value:topKills.kills}:null,mostUsedWeapon:mostUsedWeapon?{type:mostUsedWeapon[0],uses:mostUsedWeapon[1]}:null};
}
export function publicRoomState7A1(room){const s=basePublic(room);s.phase='7A.1';s.matchStats=publicStats(room);s.eventFeed=[...ensureTelemetry(room).events];s.deathAttribution={...ensureTelemetry(room).deathAttribution};s.matchSummary=summary(room);s.rematchRules={hostOnly:true,sameMap:true,randomMap:true};return s;}
export function advanceTurnIfDue7A1(code,now=Date.now()){const room=getRoom(code),before=snapshot(room);const changed=baseAdvance(code,now);if(changed)observe(changed,before);return changed;}
export function moveActivePlayer7A1(id,d){const room=findRoomBySocket(id),before=snapshot(room);const r=baseMove(id,d);if(r.ok)observe(r.room,before,{actorId:id,sourceId:id,weaponType:'movement'});return r;}
export function jumpActivePlayer7A1(id,d){const room=findRoomBySocket(id),before=snapshot(room);const r=baseJump(id,d);if(r.ok)observe(r.room,before,{actorId:id,sourceId:id,weaponType:'movement'});return r;}
export function setAim7A1(id,angle,power){return setAim(id,angle,power);}
export function selectItem7A1(id,slot){return baseSelect(id,slot);}
export function fireProjectile7A1(id){
  const room=findRoomBySocket(id),before=snapshot(room),selected=room?.players.find(p=>p.id===id),slot=selected?.selectedItemSlot??1,weapon=slot>1?(selected?.inventory?.[slot-2]?.type??'basic'):'basic',r=baseFire(id);
  if(r.ok){const t=ensureTelemetry(r.room);if(t.stats[id]){t.stats[id].shotsFired+=1;t.stats[id].weaponUses[weapon]=(t.stats[id].weaponUses[weapon]??0)+1;}observe(r.room,before,{actorId:id,sourceId:id,weaponType:weapon});if(r.room.match?.projectile)pushEvent(r.room,'fire',`${nameOf(r.room,id)} fired ${String(weapon).toUpperCase()}.`,{playerId:id,weaponType:weapon});}
  return r;
}
export function setTerrain7A1(id,preset){if(preset!=='random')return setTerrainPreset(id,preset);const room=findRoomBySocket(id);if(!room)return{ok:false,error:'not_in_room'};if(room.status!=='lobby')return{ok:false,error:'room_already_started'};if(room.hostId!==id)return{ok:false,error:'host_only'};const choices=TERRAIN_IDS.filter(x=>x!==room.terrainPreset);room.terrainPreset=choices[randomInt(choices.length)];for(const p of room.players)p.ready=false;return{ok:true,room};}
export function rematchRoom7A1(id,{randomMap=false}={}){const room=findRoomBySocket(id);if(!room)return{ok:false,error:'not_in_room'};if(room.hostId!==id)return{ok:false,error:'host_only'};if(room.status!=='finished')return{ok:false,error:'match_not_finished'};if(randomMap){const choices=TERRAIN_IDS.filter(x=>x!==room.terrainPreset);room.terrainPreset=choices[randomInt(choices.length)];}room.status='lobby';room.arena=null;room.match=null;room.camera=null;room.pickups=[];room.lastPickupSpawnTurn=0;room.matchTelemetry=null;for(const p of room.players){p.ready=true;p.alive=true;p.hp=100;p.spawn=null;p.motion=null;p.lastDamage=null;p.lastPickup=null;p.lastUtility=null;p.inventory=[null,null];p.selectedItemSlot=1;p.shield=null;}const started=startRoom(id);if(started.ok){ensureTelemetry(started.room);pushEvent(started.room,'rematch',randomMap?'Rematch started on a random map.':'Rematch started on the same map.',{randomMap});}return started;}
