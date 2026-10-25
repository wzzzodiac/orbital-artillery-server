import {THEMED_BITMAP_MAPS,themedArenaMetadata} from './themed-maps.js?v=bitmap-maps-1';
import {createGameplayCore} from './core.js?v=contact-fix-20261025';
import {ITEM_POOL,nextEventId} from './rules.js';
import {practiceProfile} from './practice-profiles.js';
import {HUANCAVELICA_V2_SCALE as scale,HUANCAVELICA_V2_REVISION as revision,HUANCAVELICA_V2_COLLISION_MODEL as model} from './terrain.js?v=bitmap-maps-1';
export const PRACTICE_LIMITS=Object.freeze({pickups:16,events:36,attacks:100,fireCraterThreshold:400,hardCraterBudget:512,restockMs:3000});
const stations=[[200,379],[720,89],[535,145],[885,145],[420,247],[1040,247],[582,300],[860,300],[630,350],[810,350],[720,449],[420,532],[1020,532],[320,666],[1120,666],[500,735]];
export function createPracticeSession(mask,{seed=12345,now=0,profile='legacy',mapId='huancavelica-v2'}={}){
 const map=THEMED_BITMAP_MAPS[mapId];if(mapId!=='huancavelica-v2'&&!map)throw new RangeError('Unknown practice map');
 const createCore=settings=>createGameplayCore(mask,{practice:true,tuning:settings,terrainConfig:map?.geometry});
 let settings=practiceProfile(profile),core=createCore(settings);
 let room,disposed=false,generation=0,lastRestock=0;
 const item=type=>ITEM_POOL.find(x=>x.type===type);
 const standing=(ix,iy)=>{const x=ix*scale,y=core.terrain.findHuancavelicaV2SurfaceBelow(room,x,iy*scale-30);return y==null?null:{x,y:y-8,facing:1};};
 const starting=index=>map?standing(map.practiceXs[index]/scale,0):standing(index?150:100,379);
 function restock(clock){
  if(room.pickups.length>=PRACTICE_LIMITS.pickups)return;
  for(const [index,[ix,iy]]of (map?map.pickupXs.map(x=>[x/scale,0]):stations).entries()){
   if(room.pickups.some(b=>b.station===index))continue;
   const pos=standing(ix,iy);if(!pos)continue;const chosen=ITEM_POOL[index%ITEM_POOL.length];
   room.pickups.push({...chosen,id:nextEventId(room.simulation,'pickup'),station:index,x:pos.x,y:pos.y-16,spawnTurn:1,createdAt:clock});
   if(room.pickups.length>=PRACTICE_LIMITS.pickups)break;
  }
 }
 function reset(clock,profile=settings.id){
  if(disposed)return false;
  const next=practiceProfile(profile);
  if(next!==settings){settings=next;core=createCore(settings);}
  generation++;
  room={code:'TRY-IT-'+generation,practice:true,status:'started',mode:'team',terrainPreset:'huancavelica-v2',simulation:{seed,eventSequence:0,now:clock},events:[],pickups:[],attacks:0,
   arena:{worldWidth:5000,worldHeight:3750,terrainPreset:'huancavelica-v2',phase11Theme:'huancavelica-v2',terrainName:'Huancavelica Simulator v2',terrainRevision:revision,collisionModel:model,platforms:[],previewSpawns:[],craters:[]},
   players:[],match:{activePlayerId:'local',turnOrder:['local'],turnIndex:0,turnNumber:1,turnDurationMs:40000,turnStartedAt:clock,turnEndsAt:Number.MAX_SAFE_INTEGER,aimAngle:5,aimPower:10,wind:{signed:0,direction:'none',strength:0},projectile:null},camera:{mode:'follow',targetPlayerId:'local'}};
  const actor=(id,name,team,spawn,dummy=false)=>({id,name,team,dummy,...(dummy&&settings.dynamicDummy?{dynamicBody:true}:{}),alive:true,hp:100,maxHp:100,spawn,motion:null,airborne:null,v2HorizontalInput:0,inventory:[null,null],selectedItemSlot:1,shield:null,lastDamage:null});
  if(map){room.terrainPreset=map.id;room.arena={...room.arena,...themedArenaMetadata(map)};delete room.arena.phase11Theme;}
  room.players=[actor('local','YOU','A',starting(0)),actor('dummy','DUMMY','B',starting(1),true)];
  room.practiceProfile=settings.id;
  room.practiceMetrics={jump:null,shot:null};
  lastRestock=clock;restock(clock);return true;
 }
 function command(event,payload={},clock){
  if(disposed)return{ok:false,error:'session_disposed'};
  const p=room.players[0];
  if(event==='fire_projectile'){
   const type=p.selectedItemSlot>1?p.inventory[p.selectedItemSlot-2]?.type:'basic';
   if(!['heal','shield'].includes(type)&&(room.attacks>=PRACTICE_LIMITS.attacks||room.arena.craters.length>=PRACTICE_LIMITS.fireCraterThreshold))return{ok:false,error:'arena_budget_reset_required'};
  }
  const result=core.command(room,'local',event,payload,clock);
  if(result.ok&&event==='fire_projectile'&&room.match.projectile)room.attacks++;
  if(result.ok&&event==='jump_player')room.practiceMetrics.jump={startedAt:clock,startX:p.spawn.x,startY:p.spawn.y,apexY:p.spawn.y,airtimeMs:0,height:0,distance:0,landed:false};
  if(result.ok&&event==='fire_projectile'&&room.match.projectile){const q=room.match.projectile;room.practiceMetrics.shot={weapon:q.weaponType,power:q.power,launchDelayMs:q.startedAt-clock,flightMs:Math.round(q.durationMs),contact:q.impactReason,hitPlayerId:q.hitPlayerId??null};}
  return result;
 }
 function equip(type,clock){
  if(disposed)return{ok:false,error:'session_disposed'};if(room.match.projectile)return{ok:false,error:'shot_in_flight'};
  const p=room.players[0];if(type==='basic'){p.selectedItemSlot=1;return{ok:true};}
  const chosen=item(type);if(!chosen)return{ok:false,error:'invalid_item'};
  p.inventory[0]={type:chosen.type,label:chosen.label};p.selectedItemSlot=2;return{ok:true};
 }
 function resetDummy(){
  if(disposed)return false;if(room.match.projectile)return false;
  const dummy=room.players[1],spawn=settings.dynamicDummy?starting(1):dummy.spawn;
  if(!spawn)return false;
  Object.assign(dummy,{spawn,hp:100,alive:true,airborne:null,motion:null,lastDamage:null,shield:null,...(dummy.dynamicBody?{outOfWorld:false}:{})});return true;
 }
 function recoverPlayer(){
  if(disposed||room.match.projectile)return false;const spawn=starting(0);if(!spawn)return false;
  Object.assign(room.players[0],{spawn,hp:100,alive:true,airborne:null,motion:null,v2HorizontalInput:0,lastDamage:null,shield:null});room.practiceMetrics.jump=null;return true;
 }
 function tick(clock){
  if(disposed)return;const wasAirborne=Boolean(room.players[0].airborne);core.tick(room,clock);
  const p=room.players[0],jump=room.practiceMetrics.jump;
  if(jump&&!jump.ended&&wasAirborne){jump.apexY=Math.min(jump.apexY,p.spawn.y);jump.height=Math.round(jump.startY-jump.apexY);jump.distance=Math.round(p.spawn.x-jump.startX);jump.airtimeMs=clock-jump.startedAt;if(!p.airborne){jump.landed=p.alive;jump.ended=true;}}
  if(clock-lastRestock>=PRACTICE_LIMITS.restockMs){lastRestock=clock;restock(clock);}
  if(room.arena.craters.length>PRACTICE_LIMITS.hardCraterBudget)throw new Error('Practice cut budget exceeded');
 }
 reset(now);
 return Object.freeze({command,equip,tick,reset,resetDummy,recoverPlayer,
  getState:()=>disposed?null:core.snapshot(room),
  dispose(){disposed=true;room=null;},
  get profile(){return settings;},get disposed(){return disposed;},get generation(){return generation;}});
}
