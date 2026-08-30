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

// Alpine Ridge v5 — traced from the approved concept composition.
// The big side masses are deliberately built from overlapping cliff shelves so
// the renderer reads them as tall continuous rock towers. The middle stays open:
// a crown, two upper wings, two small high steps, one upper-center island,
// mirrored mid transitions, a center support island and four low stepping rocks.
// Geometry is nudged only where necessary to keep every route within the existing
// traversal envelope; no teleport or new mobility rule is used.
const HUANCAVELICA_PLATFORMS=Object.freeze([
  // LEFT TOWER — concept shoulder, main cap, shelves and bottom exit.
  {id:'left-shoulder-high',x1:900,x2:1260,y:1435,depth:300,kind:'cliff',links:['left-cliff-top','high-step-left']},
  {id:'left-cliff-top',x1:0,x2:980,y:1665,depth:930,kind:'cliff',links:['left-shoulder-high','left-upper-ledge']},
  {id:'left-upper-ledge',x1:440,x2:980,y:2150,depth:680,kind:'cliff',links:['left-cliff-top','left-cliff-mid','mid-left-high']},
  {id:'left-cliff-mid',x1:0,x2:430,y:2780,depth:780,kind:'cliff',links:['left-upper-ledge','left-transition']},
  {id:'left-transition',x1:450,x2:830,y:3190,depth:700,kind:'cliff',links:['left-cliff-mid','left-lower-ledge','mid-left-high']},
  {id:'left-lower-ledge',x1:0,x2:480,y:3820,depth:690,kind:'cliff',links:['left-transition','left-bottom-ledge']},
  {id:'left-bottom-ledge',x1:500,x2:920,y:4350,depth:600,kind:'cliff',links:['left-lower-ledge','left-bottom-exit']},
  {id:'left-bottom-exit',x1:780,x2:1410,y:4890,depth:270,kind:'island',links:['left-bottom-ledge','low-step-left']},

  // RIGHT TOWER — physical mirror of the left tower.
  {id:'right-shoulder-high',x1:3740,x2:4100,y:1435,depth:300,kind:'cliff',links:['right-cliff-top','high-step-right']},
  {id:'right-cliff-top',x1:4020,x2:5000,y:1665,depth:930,kind:'cliff',links:['right-shoulder-high','right-upper-ledge']},
  {id:'right-upper-ledge',x1:4020,x2:4560,y:2150,depth:680,kind:'cliff',links:['right-cliff-top','right-cliff-mid','mid-right-high']},
  {id:'right-cliff-mid',x1:4570,x2:5000,y:2780,depth:780,kind:'cliff',links:['right-upper-ledge','right-transition']},
  {id:'right-transition',x1:4170,x2:4550,y:3190,depth:700,kind:'cliff',links:['right-cliff-mid','right-lower-ledge','mid-right-high']},
  {id:'right-lower-ledge',x1:4520,x2:5000,y:3820,depth:690,kind:'cliff',links:['right-transition','right-bottom-ledge']},
  {id:'right-bottom-ledge',x1:4080,x2:4500,y:4350,depth:600,kind:'cliff',links:['right-lower-ledge','right-bottom-exit']},
  {id:'right-bottom-exit',x1:3590,x2:4220,y:4890,depth:270,kind:'island',links:['right-bottom-ledge','low-step-right']},

  // UPPER CROWN — follows the concept's red-route silhouette.
  {id:'top-center',x1:2180,x2:2980,y:675,depth:430,kind:'island',links:['upper-left','upper-right']},
  {id:'upper-left',x1:1780,x2:2260,y:1130,depth:300,kind:'island',links:['top-center','high-step-left']},
  {id:'upper-right',x1:2740,x2:3220,y:1130,depth:300,kind:'island',links:['top-center','high-step-right']},
  {id:'high-step-left',x1:1480,x2:1870,y:1650,depth:250,kind:'island',links:['upper-left','left-shoulder-high','center-upper']},
  {id:'high-step-right',x1:3130,x2:3520,y:1650,depth:250,kind:'island',links:['upper-right','right-shoulder-high','center-upper']},
  {id:'center-upper',x1:2160,x2:2960,y:2000,depth:400,kind:'island',links:['high-step-left','high-step-right','mid-left-high','mid-right-high']},

  // MIDDLE TRANSITIONS — separated islands, not a filled block wall.
  {id:'mid-left-high',x1:1230,x2:1740,y:2750,depth:430,kind:'island',links:['left-upper-ledge','left-transition','center-upper','mid-left-low']},
  {id:'mid-right-high',x1:3260,x2:3770,y:2750,depth:430,kind:'island',links:['right-upper-ledge','right-transition','center-upper','mid-right-low']},
  {id:'mid-left-low',x1:1560,x2:2070,y:3020,depth:390,kind:'island',links:['mid-left-high','center-mid','low-step-left']},
  {id:'mid-right-low',x1:2930,x2:3440,y:3020,depth:390,kind:'island',links:['mid-right-high','center-mid','low-step-right']},
  {id:'center-mid',x1:2110,x2:2960,y:3450,depth:430,kind:'island',links:['mid-left-low','mid-right-low','low-step-left','low-step-right']},

  // LOWER VOID STEPS — the four small rocks visible in the concept.
  {id:'low-step-left',x1:1730,x2:2125,y:4015,depth:270,kind:'island',links:['mid-left-low','center-mid','left-bottom-exit','bottom-step-left']},
  {id:'low-step-right',x1:2875,x2:3270,y:4015,depth:270,kind:'island',links:['mid-right-low','center-mid','right-bottom-exit','bottom-step-right']},
  {id:'bottom-step-left',x1:2100,x2:2430,y:4495,depth:260,kind:'island',links:['low-step-left','bottom-step-right']},
  {id:'bottom-step-right',x1:2570,x2:2900,y:4495,depth:260,kind:'island',links:['low-step-right','bottom-step-left']}
]);

const PLATFORM_BY_ID=new Map(HUANCAVELICA_PLATFORMS.map(p=>[p.id,p]));
const SPAWN_PLATFORM_IDS=['left-cliff-top','right-cliff-top','mid-left-high','mid-right-high','center-mid','center-upper','mid-left-low','mid-right-low'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const isHuancavelica=room=>room?.phase10TerrainAlias===HUANCAVELICA_ID||room?.arena?.phase10Theme===HUANCAVELICA_ID;

function craterAdjustedY(room,platform,x,ignoredCrater=null){
  let y=platform.y;
  for(const crater of room?.arena?.craters??[]){
    if(crater===ignoredCrater)continue;
    if(crater.phase10PlatformId&&crater.phase10PlatformId!==platform.id)continue;
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
function publicPlatforms(){return HUANCAVELICA_PLATFORMS.map(p=>({...p,links:[...p.links]}));}
function snapPickupsToPlatforms(room){if(!isHuancavelica(room))return;for(const box of room.pickups??[]){const support=topPlatformAtX(room,Number(box.x));if(support)box.y=Math.round(support.y-24);}}

function installHuancavelicaArena(room){
  if(!isHuancavelica(room)||!room?.arena)return room;
  room.arena.phase10Theme=HUANCAVELICA_ID;room.arena.terrainName=HUANCAVELICA_NAME;room.arena.collisionModel='multilayer-platforms-v2';room.arena.platforms=publicPlatforms();room.arena.voidFloor=true;room.arena.legacyCollisionBase=COLLISION_BASE;
  const count=Math.max(1,room.players.length);
  room.players.forEach((player,index)=>{let platform=platformAt(player.phase10PlatformId);if(!platform){platform=platformAt(SPAWN_PLATFORM_IDS[index%SPAWN_PLATFORM_IDS.length]);player.phase10PlatformId=platform.id;const lane=(index+1)/(count+1),x=Math.round(platform.x1+(platform.x2-platform.x1)*clamp(lane,.18,.82));player.spawn={x,y:Math.round(platformSurface(room,platform,x)-GROUND_OFFSET),facing:x<WORLD_WIDTH/2?1:-1};player.motion=null;}else if(player.spawn&&player.alive!==false&&Number(player.spawn.y)<=WORLD_HEIGHT){player.spawn.y=Math.round(platformSurface(room,platform,player.spawn.x)-GROUND_OFFSET);}});
  snapPickupsToPlatforms(room);return room;
}

function validateAction(room,player){if(!room)return'not_in_room';if(room.status!=='started')return'match_not_started';if(room.match?.activePlayerId!==player?.id)return'not_your_turn';if(room.match?.projectile)return'shot_in_flight';if(player?.alive===false)return'player_missing';if(player?.motion&&Date.now()<Number(player.motion.endsAt??0))return'player_in_motion';return null;}
function collectAfterCustomMotion(room,player,id){phase9AirPickupTestHooks.collectOneAlongMotion?.(room,player,id);phase9TestHooks.collectOneByTouch?.(room,player);phase9TestHooks.maintainPhase9Pickups?.(room);snapPickupsToPlatforms(room);}

function moveOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};const dir=Number(direction)<0?-1:Number(direction)>0?1:0;if(!dir)return{ok:false,error:'invalid_direction'};
  let platform=platformAt(player.phase10PlatformId);if(!platform){const nearest=nearestPlatformForPoint(room,player.spawn?.x??2500,player.spawn?.y??2500);platform=nearest.platform;player.phase10PlatformId=platform.id;}
  const from={...player.spawn},nextX=from.x+dir*WALK_STEP;
  if(platformContains(platform,nextX)){const nextY=Math.round(platformSurface(room,platform,nextX)-GROUND_OFFSET),now=Date.now();player.spawn={x:nextX,y:nextY,facing:dir};player.motion={type:'move',startedAt:now,endsAt:now+MOVE_VISUAL_MS,fromX:from.x,fromY:from.y,toX:nextX,toY:nextY,apex:0};collectAfterCustomMotion(room,player,id);return{ok:true,room,phase10PlatformId:platform.id};}
  return{ok:false,error:'terrain_too_steep'};
}

function jumpOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};const dir=Number(direction)<0?-1:Number(direction)>0?1:(player.spawn?.facing||1);
  let platform=platformAt(player.phase10PlatformId);if(!platform){const nearest=nearestPlatformForPoint(room,player.spawn?.x??2500,player.spawn?.y??2500);platform=nearest.platform;player.phase10PlatformId=platform.id;}const from={...player.spawn};
  const choices=platform.links.map(platformAt).filter(Boolean).map(target=>{const desired=from.x+dir*NORMAL_JUMP_DISTANCE,landingX=clamp(desired,target.x1+EDGE_MARGIN,target.x2-EDGE_MARGIN),dx=landingX-from.x,dy=platformSurface(room,target,landingX)-(from.y+GROUND_OFFSET);return{target,landingX,dx,dy,distance:Math.abs(dx)};}).filter(v=>Math.sign(v.dx)===dir&&v.distance<=MAX_LINK_JUMP&&v.distance>=60&&Math.abs(v.dy)<=MAX_PLATFORM_RISE).sort((a,b)=>a.distance-b.distance||Math.abs(a.dy)-Math.abs(b.dy));
  const choice=choices[0]??null;let toX,toY,toPlatform=platform,apex=150;
  if(choice){toPlatform=choice.target;toX=choice.landingX;toY=Math.round(platformSurface(room,toPlatform,toX)-GROUND_OFFSET);apex=Math.min(1050,Math.max(150,from.y-toY+100,Math.abs(toY-from.y)*.72+150));}else{toX=clamp(from.x+dir*NORMAL_JUMP_DISTANCE,platform.x1+EDGE_MARGIN,platform.x2-EDGE_MARGIN);toY=Math.round(platformSurface(room,platform,toX)-GROUND_OFFSET);}
  const now=Date.now(),distance=Math.abs(toX-from.x),duration=Math.round(clamp(JUMP_DURATION_MS+(distance-NORMAL_JUMP_DISTANCE)*.55,520,820));player.phase10PlatformId=toPlatform.id;player.spawn={x:toX,y:toY,facing:dir};player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX,toY,apex,phase10PlatformJump:true,fromPlatformId:platform.id,toPlatformId:toPlatform.id};collectAfterCustomMotion(room,player,id);return{ok:true,room,phase10PlatformJump:true};
}

function ballisticPoint(q,t){return{x:Number(q.startX)+Number(q.vx??0)*t+.5*Number(q.windAccel??0)*t*t,y:Number(q.startY)+Number(q.vy??0)*t+.5*Number(q.gravity??480)*t*t};}
function firstPlatformImpact(room,q,maxSeconds=8){if(!q||!Number.isFinite(Number(q.startX))||!Number.isFinite(Number(q.startY)))return null;let previous=ballisticPoint(q,.07);const dt=.012;for(let t=.082;t<=maxSeconds;t+=dt){const point=ballisticPoint(q,t);if(point.x<0||point.x>WORLD_WIDTH||point.y>WORLD_HEIGHT+150)return null;for(const platform of HUANCAVELICA_PLATFORMS){if(!platformContains(platform,point.x))continue;const surface=platformSurface(room,platform,point.x),prevSurface=platformContains(platform,previous.x)?platformSurface(room,platform,previous.x):surface;if(previous.y<prevSurface-2&&point.y>=surface-2)return{x:point.x,y:surface,t,platformId:platform.id};}previous=point;}return null;}
function applyImpact(q,impact){if(!q||!impact)return false;const candidateAt=Number(q.startedAt)+Math.round(impact.t*1000);if(q.impactReason==='player'&&Number(q.impactAt)<=candidateAt)return false;q.impactReason='terrain';q.hitPlayerId=null;q.impactX=impact.x;q.impactY=impact.y;q.durationMs=Math.max(220,Math.round(impact.t*1000));q.impactAt=Number(q.startedAt)+q.durationMs;q.phase10PlatformId=impact.platformId;return true;}
function adjustProjectileToPlatforms(room,q){
  if(!q)return false;let changed=false;
  if(q.weaponType==='airstrike'){for(const shell of q.airStrikeShells??[]){const support=topPlatformAtX(room,Number(shell.x));if(support){shell.y=support.y;shell.phase10PlatformId=support.platform.id;changed=true;}}return changed;}
  if(q.weaponType==='triple'&&Array.isArray(q.volley)){for(const shot of q.volley){const impact=firstPlatformImpact(room,shot);if(impact)changed=applyImpact(shot,impact)||changed;}q.specialResolveAt=Math.max(...q.volley.map(v=>Number(v.impactAt??0)));q.resolveAt=q.specialResolveAt+900;return changed;}
  const oldX=Number(q.impactX),oldY=Number(q.impactY),impact=firstPlatformImpact(room,q);if(impact)changed=applyImpact(q,impact)||changed;
  if(q.weaponType==='cluster'&&changed){const dx=Number(q.impactX)-oldX,dy=Number(q.impactY)-oldY;q.clusterImpacts=(q.clusterImpacts??[]).map((child,index)=>{const x=clamp(Number(child.x)+dx,0,WORLD_WIDTH),candidateY=clamp(Number(child.y)+dy,100,WORLD_HEIGHT),support=nearestPlatformForPoint(room,x,candidateY);return{...child,x,y:support?.y??candidateY,phase10PlatformId:support?.platform?.id??null,visualStartAt:q.impactAt+667+index*167,impactAt:q.impactAt+667+index*167+1333};});q.specialResolveAt=Math.max(...q.clusterImpacts.map(v=>v.impactAt));q.resolveAt=q.specialResolveAt+900;}
  else if(q.weaponType==='nuke'&&changed){q.targetX=q.impactX;q.targetY=q.impactY;if(q.nukeBeam)q.nukeBeam={...q.nukeBeam,bx:q.impactX,by:q.impactY};q.targetLockedAt=q.impactAt;q.warningUntil=q.impactAt+5000;q.beamAt=q.warningUntil;q.beamUntil=q.beamAt+5000;q.resolveAt=q.beamUntil+1500;}
  else if(changed)q.resolveAt=Math.max(Number(q.resolveAt??0),q.impactAt+900);return changed;
}

function projectileImpactHints(room,q){
  if(!q)return[];
  const hints=[];
  const add=entry=>{if(!entry||!Number.isFinite(Number(entry.x??entry.impactX)))return;const x=Number(entry.x??entry.impactX),y=Number(entry.y??entry.impactY),preferred=platformAt(entry.phase10PlatformId);const support=preferred?{platform:preferred,x,y:platformSurface(room,preferred,x)}:nearestPlatformForPoint(room,x,Number.isFinite(y)?y:WORLD_HEIGHT/2);if(support)hints.push({x,y:Number.isFinite(y)?y:support.y,platformId:support.platform.id});};
  add(q);
  for(const shot of q.volley??[])add(shot);
  for(const child of q.clusterImpacts??[])add(child);
  for(const shell of q.airStrikeShells??[])add(shell);
  if(q.weaponType==='nuke'&&q.nukeBeam){
    const {ax,ay,bx,by}=q.nukeBeam,span=Number(bx)-Number(ax);
    if(Math.abs(span)>1)for(const platform of HUANCAVELICA_PLATFORMS){const x=(platform.x1+platform.x2)/2,y=Number(ay)+(Number(by)-Number(ay))*((x-Number(ax))/span);if(y>=platform.y-180&&y<=platform.y+platform.depth)add({x,y,phase10PlatformId:platform.id});}
  }
  return hints;
}

function bindCraterToPlatform(room,crater,hints=[]){
  if(crater.phase10PlatformId&&Number.isFinite(Number(crater.y)))return crater;
  const x=Number(crater.x),craterY=Number(crater.y);
  const ranked=hints.map(hint=>({...hint,score:Math.abs(hint.x-x)+(Number.isFinite(craterY)?Math.abs(hint.y-craterY)*.6:0)})).sort((a,b)=>a.score-b.score);
  let platform=platformAt(ranked[0]?.platformId);
  if(!platform&&Number.isFinite(craterY))platform=nearestPlatformForPoint(room,x,craterY)?.platform??null;
  if(!platform)platform=topPlatformAtX(room,x)?.platform??nearestPlatformForPoint(room,x,WORLD_HEIGHT/2)?.platform??null;
  if(!platform)return crater;
  crater.phase10PlatformId=platform.id;
  crater.y=Math.round(craterAdjustedY(room,platform,clamp(x,platform.x1,platform.x2),crater));
  return crater;
}

function bindNewCraters(room,knownIds,hints){
  for(const crater of room?.arena?.craters??[])if(!knownIds.has(crater.id)||!crater.phase10PlatformId)bindCraterToPlatform(room,crater,hints);
}

function fireOnHuancavelica(id){const room=findRoomBySocket(id);installHuancavelicaArena(room);const result=baseFireProjectile9(id);if(result?.ok&&isHuancavelica(result.room)){installHuancavelicaArena(result.room);adjustProjectileToPlatforms(result.room,result.room.match?.projectile);}return result;}
function advanceOnHuancavelica(code,now=Date.now()){const room=getRoom(code),knownIds=new Set(room?.arena?.craters?.map(c=>c.id)??[]),hints=projectileImpactHints(room,room?.match?.projectile),changed=baseAdvanceTurnIfDue9(code,now),target=changed??room;if(target&&isHuancavelica(target)){bindNewCraters(target,knownIds,hints);installHuancavelicaArena(target);snapPickupsToPlatforms(target);}return changed;}

function decoratePublicState(room,state){const presets=[...(state?.terrainPresets??[])];if(!presets.some(entry=>entry.id===HUANCAVELICA_ID))presets.push({id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME});state.terrainPresets=presets;if(isHuancavelica(room)){installHuancavelicaArena(room);state=basePublicRoomState9(room);state.terrainPresets=presets;state.terrainPreset=HUANCAVELICA_ID;state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_ID,terrainName:HUANCAVELICA_NAME,phase10Theme:HUANCAVELICA_ID,collisionModel:'multilayer-platforms-v2',platforms:publicPlatforms(),voidFloor:true,legacyCollisionBase:COLLISION_BASE};state.players=(state.players??[]).map(p=>({...p,phase10PlatformId:room.players.find(source=>source.id===p.id)?.phase10PlatformId??null}));state.phase10Map={id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME,visualTheme:'bright-alpine-floating-islands',collisionModel:'multilayer-platforms-v2',platformCount:HUANCAVELICA_PLATFORMS.length,allPrimaryPlatformsReachableByLinks:true,freeMovement:true,normalJumpDistance:NORMAL_JUMP_DISTANCE,adaptiveMaxLinkDistance:MAX_LINK_JUMP,productionReady:true};}return state;}
export function publicRoomState9(room){if(isHuancavelica(room))installHuancavelicaArena(room);return decoratePublicState(room,basePublicRoomState9(room));}
export function setTerrain9(id,terrain){const requested=String(terrain??'').toLowerCase();if(requested===HUANCAVELICA_ID){const result=baseSetTerrain9(id,COLLISION_BASE);if(result?.ok){result.room.phase10TerrainAlias=HUANCAVELICA_ID;result.room.phase10MapRevision='10d-alpine-ridge-production';for(const player of result.room.players??[]){player.ready=false;player.phase10PlatformId=null;}}return result;}const room=findRoomBySocket(id);if(room){room.phase10TerrainAlias=null;for(const player of room.players??[])player.phase10PlatformId=null;}return baseSetTerrain9(id,requested);}
export function moveActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?moveOnHuancavelica(id,direction):baseMoveActivePlayer9(id,direction);}
export function jumpActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?jumpOnHuancavelica(id,direction):baseJumpActivePlayer9(id,direction);}
export function fireProjectile9(id){const room=findRoomBySocket(id);return isHuancavelica(room)?fireOnHuancavelica(id):baseFireProjectile9(id);}
export function advanceTurnIfDue9(code,now=Date.now()){return advanceOnHuancavelica(code,now);}
export function rematchRoom9(id,options={}){const room=findRoomBySocket(id),keepAlias=room?.phase10TerrainAlias===HUANCAVELICA_ID&&!options?.randomMap;const result=baseRematchRoom9(id,options);if(result?.ok){result.room.phase10TerrainAlias=keepAlias?HUANCAVELICA_ID:null;result.room.phase10MapRevision=keepAlias?'10d-alpine-ridge-production':null;for(const player of result.room.players??[])player.phase10PlatformId=null;if(keepAlias)installHuancavelicaArena(result.room);}return result;}

export {disconnectPlayer9,phase9AirPickupTestHooks,phase9TestHooks,phase9TraversalTestHooks,selectItem9,setAim9};
export const phase10HuancavelicaTestHooks=Object.freeze({HUANCAVELICA_ID,HUANCAVELICA_NAME,COLLISION_BASE,HUANCAVELICA_PLATFORMS,decoratePublicState,installHuancavelicaArena,platformSurface,topPlatformAtX,nearestPlatformForPoint,firstPlatformImpact,adjustProjectileToPlatforms,projectileImpactHints,bindCraterToPlatform,bindNewCraters});

