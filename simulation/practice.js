import {createGameplayCore} from './core.js';
import {ITEM_POOL,nextEventId} from './rules.js';
import {HUANCAVELICA_V2_SCALE as scale,HUANCAVELICA_V2_REVISION as revision,HUANCAVELICA_V2_COLLISION_MODEL as model} from './terrain.js';
export const PRACTICE_LIMITS=Object.freeze({pickups:16,events:36,attacks:100,fireCraterThreshold:400,hardCraterBudget:512,restockMs:3000});
const stations=[[200,379],[720,89],[535,145],[885,145],[420,247],[1040,247],[582,300],[860,300],[630,350],[810,350],[720,449],[420,532],[1020,532],[320,666],[1120,666],[500,735]];
export function createPracticeSession(mask,{seed=12345,now=0}={}){
 const core=createGameplayCore(mask,{practice:true});let room,disposed=false,generation=0,lastRestock=0;
 const item=type=>ITEM_POOL.find(x=>x.type===type);
 const standing=(ix,iy)=>{const x=ix*scale,y=core.terrain.findHuancavelicaV2SurfaceBelow(room,x,iy*scale-30);return y==null?null:{x,y:y-8,facing:1};};
 function restock(clock){
  if(room.pickups.length>=PRACTICE_LIMITS.pickups)return;
  for(const [index,[ix,iy]]of stations.entries()){
   if(room.pickups.some(b=>b.station===index))continue;
   const pos=standing(ix,iy);if(!pos)continue;const chosen=ITEM_POOL[index%ITEM_POOL.length];
   room.pickups.push({...chosen,id:nextEventId(room.simulation,'pickup'),station:index,x:pos.x,y:pos.y-16,spawnTurn:1,createdAt:clock});
   if(room.pickups.length>=PRACTICE_LIMITS.pickups)break;
  }
 }
 function reset(clock){
  if(disposed)return false;generation++;
  room={code:'TRY-IT-'+generation,practice:true,status:'started',mode:'team',terrainPreset:'huancavelica-v2',simulation:{seed,eventSequence:0,now:clock},events:[],pickups:[],attacks:0,
   arena:{worldWidth:5000,worldHeight:3750,terrainPreset:'huancavelica-v2',phase11Theme:'huancavelica-v2',terrainName:'Huancavelica Simulator v2',terrainRevision:revision,collisionModel:model,platforms:[],previewSpawns:[],craters:[]},
   players:[],match:{activePlayerId:'local',turnOrder:['local'],turnIndex:0,turnNumber:1,turnDurationMs:40000,turnStartedAt:clock,turnEndsAt:Number.MAX_SAFE_INTEGER,aimAngle:5,aimPower:10,wind:{signed:0,direction:'none',strength:0},projectile:null},camera:{mode:'follow',targetPlayerId:'local'}};
  const actor=(id,name,team,spawn,dummy=false)=>({id,name,team,dummy,alive:true,hp:100,maxHp:100,spawn,motion:null,airborne:null,v2HorizontalInput:0,inventory:[null,null],selectedItemSlot:1,shield:null,lastDamage:null});
  room.players=[actor('local','YOU','A',standing(100,379)),actor('dummy','DUMMY','B',standing(150,379),true)];
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
  Object.assign(room.players[1],{hp:100,alive:true,airborne:null,motion:null,lastDamage:null,shield:null});return true;
 }
 function recoverPlayer(){
  if(disposed||room.match.projectile)return false;const spawn=standing(100,379);if(!spawn)return false;
  Object.assign(room.players[0],{spawn,hp:100,alive:true,airborne:null,motion:null,v2HorizontalInput:0,lastDamage:null,shield:null});return true;
 }
 function tick(clock){
  if(disposed)return;core.tick(room,clock);
  if(clock-lastRestock>=PRACTICE_LIMITS.restockMs){lastRestock=clock;restock(clock);}
  if(room.arena.craters.length>PRACTICE_LIMITS.hardCraterBudget)throw new Error('Practice cut budget exceeded');
 }
 reset(now);
 return Object.freeze({command,equip,tick,reset,resetDummy,recoverPlayer,
  getState:()=>disposed?null:core.snapshot(room),
  dispose(){disposed=true;room=null;},
  get disposed(){return disposed;},get generation(){return generation;}});
}
