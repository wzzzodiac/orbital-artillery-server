import { findRoomBySocket, getRoom } from './rooms.js';
import {
  advanceTurnIfDue9 as baseAdvanceTurnIfDue9,
  disconnectPlayer9,
  fireProjectile9 as baseFireProjectile9,
  jumpActivePlayer9 as baseJumpActivePlayer9,
  moveActivePlayer9 as baseMoveActivePlayer9,
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
const WORLD_WIDTH=5000;
const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const WALK_STEP=15;
const MOVE_VISUAL_MS=110;
const JUMP_DURATION_MS=620;
const NORMAL_JUMP_DISTANCE=180;
const MAX_LINK_JUMP=420;
const MAX_PLATFORM_RISE=1050;
const EDGE_MARGIN=24;

const HUANCAVELICA_PLATFORMS=Object.freeze([
  {id:'left-cliff-low',x1:90,x2:690,y:3900,depth:720,kind:'cliff',links:['left-low-1']},
  {id:'left-low-1',x1:360,x2:980,y:3380,depth:520,kind:'cliff',links:['left-cliff-low','left-mid-1']},
  {id:'left-mid-1',x1:180,x2:890,y:2860,depth:590,kind:'cliff',links:['left-low-1','left-mid-2']},
  {id:'left-mid-2',x1:460,x2:1180,y:2330,depth:700,kind:'cliff',links:['left-mid-1','left-high','mid-left-low']},
  {id:'left-high',x1:120,x2:980,y:1660,depth:760,kind:'cliff',links:['left-mid-2','upper-left']},
  {id:'mid-left-low',x1:1170,x2:1720,y:3540,depth:320,kind:'island',links:['left-mid-2','mid-left','center-low','void-step-left']},
  {id:'mid-left',x1:1370,x2:1930,y:2850,depth:410,kind:'island',links:['mid-left-low','mid-left-high','center-mid']},
  {id:'mid-left-high',x1:1570,x2:2110,y:2140,depth:360,kind:'island',links:['mid-left','upper-left','center-upper']},
  {id:'upper-left',x1:1570,x2:2070,y:1420,depth:310,kind:'island',links:['left-high','mid-left-high','top-left-step']},
  {id:'top-left-step',x1:2030,x2:2270,y:1210,depth:210,kind:'island',links:['upper-left','top-center','center-upper']},
  {id:'center-low',x1:2120,x2:2880,y:3860,depth:360,kind:'island',links:['mid-left-low','mid-right-low','center-mid','void-step-left','void-step-right']},
  {id:'center-mid',x1:2070,x2:2930,y:3020,depth:430,kind:'island',links:['mid-left','mid-right','center-upper','center-low']},
  {id:'center-upper',x1:2050,x2:2950,y:2050,depth:390,kind:'island',links:['mid-left-high','mid-right-high','center-mid','top-left-step','top-right-step']},
  {id:'top-center',x1:2160,x2:2840,y:760,depth:460,kind:'island',links:['top-left-step','top-right-step']},
  {id:'top-right-step',x1:2730,x2:2970,y:1210,depth:210,kind:'island',links:['top-center','upper-right','center-upper']},
  {id:'upper-right',x1:2930,x2:3430,y:1420,depth:310,kind:'island',links:['right-high','mid-right-high','top-right-step']},
  {id:'mid-right-high',x1:2890,x2:3430,y:2140,depth:360,kind:'island',links:['mid-right','upper-right','center-upper']},
  {id:'mid-right',x1:3070,x2:3630,y:2850,depth:410,kind:'island',links:['mid-right-low','mid-right-high','center-mid']},
  {id:'mid-right-low',x1:3280,x2:3830,y:3540,depth:320,kind:'island',links:['right-mid-2','mid-right','center-low','void-step-right']},
  {id:'right-high',x1:4020,x2:4880,y:1660,depth:760,kind:'cliff',links:['right-mid-2','upper-right']},
  {id:'right-mid-2',x1:3820,x2:4540,y:2330,depth:700,kind:'cliff',links:['right-mid-1','right-high','mid-right-low']},
  {id:'right-mid-1',x1:4110,x2:4820,y:2860,depth:590,kind:'cliff',links:['right-low-1','right-mid-2']},
  {id:'right-low-1',x1:4020,x2:4640,y:3380,depth:520,kind:'cliff',links:['right-cliff-low','right-mid-1']},
  {id:'right-cliff-low',x1:4310,x2:4910,y:3900,depth:720,kind:'cliff',links:['right-low-1']},
  {id:'void-step-left',x1:1730,x2:1980,y:4140,depth:230,kind:'island',links:['mid-left-low','center-low']},
  {id:'void-step-right',x1:3020,x2:3270,y:4140,depth:230,kind:'island',links:['center-low','mid-right-low']}
]);

const PLATFORM_BY_ID=new Map(HUANCAVELICA_PLATFORMS.map(p=>[p.id,p]));
const SPAWN_PLATFORM_IDS=['left-high','right-high','mid-left','mid-right','center-low','center-mid','mid-left-low','mid-right-low'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const isHuancavelica=room=>room?.phase10TerrainAlias===HUANCAVELICA_ID||room?.arena?.phase10Theme===HUANCAVELICA_ID;

function craterAdjustedY(room,platform,x){
  let y=platform.y;
  for(const crater of room?.arena?.craters??[]){
    const dx=Math.abs(Number(x)-Number(crater.x));
    if(dx>=Number(crater.radius??0))continue;
    const cy=Number(crater.y);
    if(Number.isFinite(cy)&&Math.abs(cy-platform.y)>260)continue;
    const depth=Number(crater.depth??0);
    y+=depth*Math.sqrt(Math.max(0,1-(dx/Math.max(1,Number(crater.radius)))**2));
  }
  return clamp(y,120,WORLD_HEIGHT);
}
function platformAt(id){return PLATFORM_BY_ID.get(id)??null;}
function platformContains(platform,x,margin=0){return Boolean(platform&&x>=platform.x1-margin&&x<=platform.x2+margin);}
function platformSurface(room,platform,x){return craterAdjustedY(room,platform,clamp(x,platform.x1,platform.x2));}
function topPlatformAtX(room,x){const matches=HUANCAVELICA_PLATFORMS.filter(p=>platformContains(p,x)).map(p=>({platform:p,y:platformSurface(room,p,x)})).sort((a,b)=>a.y-b.y);return matches[0]??null;}
function nearestPlatformForPoint(room,x,y){let best=null,bestScore=Infinity;for(const platform of HUANCAVELICA_PLATFORMS){const px=clamp(x,platform.x1,platform.x2),py=platformSurface(room,platform,px),score=Math.abs(px-x)+Math.abs(py-y)*.6;if(score<bestScore){bestScore=score;best={platform,x:px,y:py};}}return best;}
function publicPlatforms(room){return HUANCAVELICA_PLATFORMS.map(p=>({...p,y:platformSurface(room,p,(p.x1+p.x2)/2),links:[...p.links]}));}
function snapPickupsToPlatforms(room){if(!isHuancavelica(room))return;for(const box of room.pickups??[]){const support=topPlatformAtX(room,Number(box.x));if(support)box.y=Math.round(support.y-24);}}

function installHuancavelicaArena(room){
  if(!isHuancavelica(room)||!room?.arena)return room;
  room.arena.phase10Theme=HUANCAVELICA_ID;room.arena.terrainName=HUANCAVELICA_NAME;room.arena.collisionModel='multilayer-platforms-v1';room.arena.platforms=publicPlatforms(room);room.arena.voidFloor=true;room.arena.legacyCollisionBase=COLLISION_BASE;
  const count=Math.max(1,room.players.length);
  room.players.forEach((player,index)=>{let platform=platformAt(player.phase10PlatformId);if(!platform){platform=platformAt(SPAWN_PLATFORM_IDS[index%SPAWN_PLATFORM_IDS.length]);player.phase10PlatformId=platform.id;const lane=(index+1)/(count+1),x=Math.round(platform.x1+(platform.x2-platform.x1)*clamp(lane,.18,.82));player.spawn={x,y:Math.round(platformSurface(room,platform,x)-GROUND_OFFSET),facing:x<WORLD_WIDTH/2?1:-1};player.motion=null;}else if(player.spawn&&player.alive!==false&&Number(player.spawn.y)<=WORLD_HEIGHT){player.spawn.y=Math.round(platformSurface(room,platform,player.spawn.x)-GROUND_OFFSET);}});
  snapPickupsToPlatforms(room);return room;
}

function validateAction(room,player){if(!room)return'not_in_room';if(room.status!=='started')return'match_not_started';if(room.match?.activePlayerId!==player?.id)return'not_your_turn';if(room.match?.projectile)return'shot_in_flight';if(player?.alive===false)return'player_missing';if(player?.motion&&Date.now()<Number(player.motion.endsAt??0))return'player_in_motion';return null;}
function withinMovementRadius(room,x){const origin=Number(room.match?.movementOriginX),radius=Number(room.match?.movementRadius??520);return !Number.isFinite(origin)||Math.abs(x-origin)<=radius+1;}
function collectAfterCustomMotion(room,player,id){phase9AirPickupTestHooks.collectOneAlongMotion?.(room,player,id);phase9TestHooks.collectOneByTouch?.(room,player);phase9TestHooks.maintainPhase9Pickups?.(room);snapPickupsToPlatforms(room);}

function moveOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};const dir=Number(direction)<0?-1:Number(direction)>0?1:0;if(!dir)return{ok:false,error:'invalid_direction'};
  let platform=platformAt(player.phase10PlatformId);if(!platform){const nearest=nearestPlatformForPoint(room,player.spawn?.x??2500,player.spawn?.y??2500);platform=nearest.platform;player.phase10PlatformId=platform.id;}
  const from={...player.spawn},nextX=from.x+dir*WALK_STEP;
  if(platformContains(platform,nextX)){if(!withinMovementRadius(room,nextX))return{ok:false,error:'movement_limit'};const nextY=Math.round(platformSurface(room,platform,nextX)-GROUND_OFFSET),now=Date.now();player.spawn={x:nextX,y:nextY,facing:dir};player.motion={type:'move',startedAt:now,endsAt:now+MOVE_VISUAL_MS,fromX:from.x,fromY:from.y,toX:nextX,toY:nextY,apex:0};collectAfterCustomMotion(room,player,id);return{ok:true,room,phase10PlatformId:platform.id};}
  return{ok:false,error:'terrain_too_steep'};
}

function jumpOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};if((room.match?.jumpsRemaining??0)<=0)return{ok:false,error:'no_jumps_remaining'};const dir=Number(direction)<0?-1:Number(direction)>0?1:(player.spawn?.facing||1);
  let platform=platformAt(player.phase10PlatformId);if(!platform){const nearest=nearestPlatformForPoint(room,player.spawn?.x??2500,player.spawn?.y??2500);platform=nearest.platform;player.phase10PlatformId=platform.id;}const from={...player.spawn};
  const choices=platform.links.map(platformAt).filter(Boolean).map(target=>{const landingX=dir>0?target.x1+EDGE_MARGIN:target.x2-EDGE_MARGIN,dx=landingX-from.x,dy=platformSurface(room,target,landingX)-(from.y+GROUND_OFFSET);return{target,landingX,dx,dy,distance:Math.abs(dx)};}).filter(v=>Math.sign(v.dx)===dir&&v.distance<=MAX_LINK_JUMP&&v.distance>=80&&Math.abs(v.dy)<=MAX_PLATFORM_RISE).sort((a,b)=>a.distance-b.distance||Math.abs(a.dy)-Math.abs(b.dy));
  const choice=choices[0]??null;let toX,toY,toPlatform=platform,apex=150;
  if(choice){toPlatform=choice.target;toX=choice.landingX;toY=Math.round(platformSurface(room,toPlatform,toX)-GROUND_OFFSET);apex=Math.min(1050,Math.max(150,from.y-toY+100,Math.abs(toY-from.y)*.72+150));}else{toX=clamp(from.x+dir*NORMAL_JUMP_DISTANCE,platform.x1+EDGE_MARGIN,platform.x2-EDGE_MARGIN);toY=Math.round(platformSurface(room,platform,toX)-GROUND_OFFSET);}
  if(!withinMovementRadius(room,toX))return{ok:false,error:'movement_limit'};const now=Date.now(),distance=Math.abs(toX-from.x),duration=Math.round(clamp(JUMP_DURATION_MS+(distance-NORMAL_JUMP_DISTANCE)*.55,520,820));player.phase10PlatformId=toPlatform.id;player.spawn={x:toX,y:toY,facing:dir};player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX,toY,apex,phase10PlatformJump:true,fromPlatformId:platform.id,toPlatformId:toPlatform.id};room.match.jumpsRemaining=Math.max(0,(room.match.jumpsRemaining??0)-1);collectAfterCustomMotion(room,player,id);return{ok:true,room,phase10PlatformJump:true};
}

function ballisticPoint(q,t){return{x:Number(q.startX)+Number(q.vx??0)*t+.5*Number(q.windAccel??0)*t*t,y:Number(q.startY)+Number(q.vy??0)*t+.5*Number(q.gravity??480)*t*t};}
function firstPlatformImpact(room,q,maxSeconds=8){if(!q||!Number.isFinite(Number(q.startX))||!Number.isFinite(Number(q.startY)))return null;let previous=ballisticPoint(q,.07);const dt=.012;for(let t=.082;t<=maxSeconds;t+=dt){const point=ballisticPoint(q,t);if(point.x<0||point.x>WORLD_WIDTH||point.y>WORLD_HEIGHT+150)return null;for(const platform of HUANCAVELICA_PLATFORMS){if(!platformContains(platform,point.x))continue;const surface=platformSurface(room,platform,point.x),prevSurface=platformContains(platform,previous.x)?platformSurface(room,platform,previous.x):surface;if(previous.y<prevSurface-2&&point.y>=surface-2)return{x:point.x,y:surface,t,platformId:platform.id};}previous=point;}return null;}
function applyImpact(q,impact){if(!q||!impact)return false;const candidateAt=Number(q.startedAt)+Math.round(impact.t*1000);if(q.impactReason==='player'&&Number(q.impactAt)<=candidateAt)return false;q.impactReason='terrain';q.hitPlayerId=null;q.impactX=impact.x;q.impactY=impact.y;q.durationMs=Math.max(220,Math.round(impact.t*1000));q.impactAt=Number(q.startedAt)+q.durationMs;q.phase10PlatformId=impact.platformId;return true;}
function adjustProjectileToPlatforms(room,q){
  if(!q)return false;let changed=false;
  if(q.weaponType==='airstrike'){for(const shell of q.airStrikeShells??[]){const support=topPlatformAtX(room,Number(shell.x));if(support){shell.y=support.y;shell.phase10PlatformId=support.platform.id;changed=true;}}return changed;}
  if(q.weaponType==='triple'&&Array.isArray(q.volley)){for(const shot of q.volley){const impact=firstPlatformImpact(room,shot);if(impact)changed=applyImpact(shot,impact)||changed;}q.specialResolveAt=Math.max(...q.volley.map(v=>Number(v.impactAt??0)));q.resolveAt=q.specialResolveAt+900;return changed;}
  const oldX=Number(q.impactX),oldY=Number(q.impactY),impact=firstPlatformImpact(room,q);if(impact)changed=applyImpact(q,impact)||changed;
  if(q.weaponType==='cluster'&&changed){const dx=Number(q.impactX)-oldX,dy=Number(q.impactY)-oldY;q.clusterImpacts=(q.clusterImpacts??[]).map((child,index)=>({...child,x:clamp(Number(child.x)+dx,0,WORLD_WIDTH),y:clamp(Number(child.y)+dy,100,WORLD_HEIGHT),visualStartAt:q.impactAt+667+index*167,impactAt:q.impactAt+667+index*167+1333}));q.specialResolveAt=Math.max(...q.clusterImpacts.map(v=>v.impactAt));q.resolveAt=q.specialResolveAt+900;}
  else if(q.weaponType==='nuke'&&changed){q.targetX=q.impactX;q.targetY=q.impactY;if(q.nukeBeam)q.nukeBeam={...q.nukeBeam,bx:q.impactX,by:q.impactY};q.targetLockedAt=q.impactAt;q.warningUntil=q.impactAt+5000;q.beamAt=q.warningUntil;q.beamUntil=q.beamAt+5000;q.resolveAt=q.beamUntil+1500;}
  else if(changed)q.resolveAt=Math.max(Number(q.resolveAt??0),q.impactAt+900);return changed;
}

function fireOnHuancavelica(id){const room=findRoomBySocket(id);installHuancavelicaArena(room);const result=baseFireProjectile9(id);if(result?.ok&&isHuancavelica(result.room)){installHuancavelicaArena(result.room);adjustProjectileToPlatforms(result.room,result.room.match?.projectile);}return result;}
function advanceOnHuancavelica(code,now=Date.now()){const room=getRoom(code);const changed=baseAdvanceTurnIfDue9(code,now),target=changed??room;if(target&&isHuancavelica(target)){installHuancavelicaArena(target);snapPickupsToPlatforms(target);}return changed;}

function decoratePublicState(room,state){const presets=[...(state?.terrainPresets??[])];if(!presets.some(entry=>entry.id===HUANCAVELICA_ID))presets.push({id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME});state.terrainPresets=presets;if(isHuancavelica(room)){installHuancavelicaArena(room);state=basePublicRoomState9(room);state.terrainPresets=presets;state.terrainPreset=HUANCAVELICA_ID;state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_ID,terrainName:HUANCAVELICA_NAME,phase10Theme:HUANCAVELICA_ID,collisionModel:'multilayer-platforms-v1',platforms:publicPlatforms(room),voidFloor:true,legacyCollisionBase:COLLISION_BASE};state.players=(state.players??[]).map(p=>({...p,phase10PlatformId:room.players.find(source=>source.id===p.id)?.phase10PlatformId??null}));state.phase10Map={id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME,visualTheme:'bright-alpine-floating-islands',collisionModel:'multilayer-platforms-v1',platformCount:HUANCAVELICA_PLATFORMS.length,allPrimaryPlatformsReachableByLinks:true,experimental:true};}return state;}
export function publicRoomState9(room){if(isHuancavelica(room))installHuancavelicaArena(room);return decoratePublicState(room,basePublicRoomState9(room));}
export function setTerrain9(id,terrain){const requested=String(terrain??'').toLowerCase();if(requested===HUANCAVELICA_ID){const result=baseSetTerrain9(id,COLLISION_BASE);if(result?.ok){result.room.phase10TerrainAlias=HUANCAVELICA_ID;result.room.phase10MapRevision='10c-multilayer-v1';for(const player of result.room.players??[]){player.ready=false;player.phase10PlatformId=null;}}return result;}const room=findRoomBySocket(id);if(room){room.phase10TerrainAlias=null;for(const player of room.players??[])player.phase10PlatformId=null;}return baseSetTerrain9(id,requested);}
export function moveActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?moveOnHuancavelica(id,direction):baseMoveActivePlayer9(id,direction);}
export function jumpActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?jumpOnHuancavelica(id,direction):baseJumpActivePlayer9(id,direction);}
export function fireProjectile9(id){const room=findRoomBySocket(id);return isHuancavelica(room)?fireOnHuancavelica(id):baseFireProjectile9(id);}
export function advanceTurnIfDue9(code,now=Date.now()){return advanceOnHuancavelica(code,now);}
export function rematchRoom9(id,options={}){const room=findRoomBySocket(id),keepAlias=room?.phase10TerrainAlias===HUANCAVELICA_ID&&!options?.randomMap;const result=baseRematchRoom9(id,options);if(result?.ok){result.room.phase10TerrainAlias=keepAlias?HUANCAVELICA_ID:null;result.room.phase10MapRevision=keepAlias?'10c-multilayer-v1':null;for(const player of result.room.players??[])player.phase10PlatformId=null;if(keepAlias)installHuancavelicaArena(result.room);}return result;}

export {disconnectPlayer9,phase9AirPickupTestHooks,phase9TestHooks,phase9TraversalTestHooks,selectItem9,setAim9};
export const phase10HuancavelicaTestHooks=Object.freeze({HUANCAVELICA_ID,HUANCAVELICA_NAME,COLLISION_BASE,HUANCAVELICA_PLATFORMS,decoratePublicState,installHuancavelicaArena,platformSurface,topPlatformAtX,nearestPlatformForPoint,firstPlatformImpact,adjustProjectileToPlatforms});
