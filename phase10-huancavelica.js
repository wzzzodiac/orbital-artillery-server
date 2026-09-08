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
import {
  HUANCAVELICA_ALPHA_THRESHOLD,
  HUANCAVELICA_IMAGE_HEIGHT,
  HUANCAVELICA_IMAGE_WIDTH,
  firstHuancavelicaMaskImpact,
  huancavelicaNearestSurface,
  huancavelicaSurfaceBelow,
  huancavelicaSurfaceNear,
  huancavelicaSurfacesAtX,
  huancavelicaTopSurface,
  isHuancavelicaSolid
} from './huancavelica-bitmap.js';

const HUANCAVELICA_ID='huancavelica';
const HUANCAVELICA_NAME='Huancavelica Simulator';
const COLLISION_BASE='islands';
const WORLD_WIDTH=5000;
const WORLD_HEIGHT=5000;
const GROUND_OFFSET=8;
const WALK_STEP=15;
const MOVE_VISUAL_MS=110;
const MAX_WALK_SURFACE_DELTA=42;
const NATURAL_DROP_MIN_MS=260;
const NATURAL_DROP_MAX_MS=1100;
const VOID_FALL_MS=1450;
const VOID_FINISH_BUFFER_MS=250;
const JUMP_DURATION_MS=620;
const NORMAL_JUMP_DISTANCE=180;
const MAX_LINK_JUMP=420;
const MAX_PLATFORM_RISE=1050;
const BASE_APEX=150;
const MAX_ADAPTIVE_APEX=1050;
const VEHICLE_BODY_HEIGHT=42;
const MIN_LANDING_RUN=28;

// These rectangles are navigation/spawn metadata only. The authored bitmap is
// authoritative for walking, jumping, projectile impact and crater collision.
const HUANCAVELICA_PLATFORMS=Object.freeze([
  {id:'left-shoulder-high',x1:900,x2:1260,y:1435,depth:300,kind:'cliff',links:['left-cliff-top','high-step-left']},
  {id:'left-cliff-top',x1:0,x2:980,y:1665,depth:930,kind:'cliff',links:['left-shoulder-high','left-upper-ledge']},
  {id:'left-upper-ledge',x1:440,x2:980,y:2150,depth:680,kind:'cliff',links:['left-cliff-top','left-cliff-mid','mid-left-high']},
  {id:'left-cliff-mid',x1:0,x2:430,y:2780,depth:780,kind:'cliff',links:['left-upper-ledge','left-transition']},
  {id:'left-transition',x1:450,x2:830,y:3190,depth:700,kind:'cliff',links:['left-cliff-mid','left-lower-ledge','mid-left-high']},
  {id:'left-lower-ledge',x1:0,x2:480,y:3820,depth:690,kind:'cliff',links:['left-transition','left-bottom-ledge']},
  {id:'left-bottom-ledge',x1:500,x2:920,y:4350,depth:600,kind:'cliff',links:['left-lower-ledge','left-bottom-exit']},
  {id:'left-bottom-exit',x1:780,x2:1410,y:4890,depth:270,kind:'island',links:['left-bottom-ledge','low-step-left']},
  {id:'right-shoulder-high',x1:3740,x2:4100,y:1435,depth:300,kind:'cliff',links:['right-cliff-top','high-step-right']},
  {id:'right-cliff-top',x1:4020,x2:5000,y:1665,depth:930,kind:'cliff',links:['right-shoulder-high','right-upper-ledge']},
  {id:'right-upper-ledge',x1:4020,x2:4560,y:2150,depth:680,kind:'cliff',links:['right-cliff-top','right-cliff-mid','mid-right-high']},
  {id:'right-cliff-mid',x1:4570,x2:5000,y:2780,depth:780,kind:'cliff',links:['right-upper-ledge','right-transition']},
  {id:'right-transition',x1:4170,x2:4550,y:3190,depth:700,kind:'cliff',links:['right-cliff-mid','right-lower-ledge','mid-right-high']},
  {id:'right-lower-ledge',x1:4520,x2:5000,y:3820,depth:690,kind:'cliff',links:['right-transition','right-bottom-ledge']},
  {id:'right-bottom-ledge',x1:4080,x2:4500,y:4350,depth:600,kind:'cliff',links:['right-lower-ledge','right-bottom-exit']},
  {id:'right-bottom-exit',x1:3590,x2:4220,y:4890,depth:270,kind:'island',links:['right-bottom-ledge','low-step-right']},
  {id:'top-center',x1:2180,x2:2980,y:675,depth:430,kind:'island',links:['upper-left','upper-right']},
  {id:'upper-left',x1:1780,x2:2260,y:1130,depth:300,kind:'island',links:['top-center','high-step-left']},
  {id:'upper-right',x1:2740,x2:3220,y:1130,depth:300,kind:'island',links:['top-center','high-step-right']},
  {id:'high-step-left',x1:1480,x2:1870,y:1650,depth:250,kind:'island',links:['upper-left','left-shoulder-high','center-upper']},
  {id:'high-step-right',x1:3130,x2:3520,y:1650,depth:250,kind:'island',links:['upper-right','right-shoulder-high','center-upper']},
  {id:'center-upper',x1:2160,x2:2960,y:2000,depth:400,kind:'island',links:['high-step-left','high-step-right','mid-left-high','mid-right-high']},
  {id:'mid-left-high',x1:1230,x2:1740,y:2750,depth:430,kind:'island',links:['left-upper-ledge','left-transition','center-upper','mid-left-low']},
  {id:'mid-right-high',x1:3260,x2:3770,y:2750,depth:430,kind:'island',links:['right-upper-ledge','right-transition','center-upper','mid-right-low']},
  {id:'mid-left-low',x1:1560,x2:2070,y:3020,depth:390,kind:'island',links:['mid-left-high','center-mid','low-step-left']},
  {id:'mid-right-low',x1:2930,x2:3440,y:3020,depth:390,kind:'island',links:['mid-right-high','center-mid','low-step-right']},
  {id:'center-mid',x1:2110,x2:2960,y:3450,depth:430,kind:'island',links:['mid-left-low','mid-right-low','low-step-left','low-step-right']},
  {id:'low-step-left',x1:1730,x2:2125,y:4015,depth:270,kind:'island',links:['mid-left-low','center-mid','left-bottom-exit','bottom-step-left']},
  {id:'low-step-right',x1:2875,x2:3270,y:4015,depth:270,kind:'island',links:['mid-right-low','center-mid','right-bottom-exit','bottom-step-right']},
  {id:'bottom-step-left',x1:2100,x2:2430,y:4495,depth:260,kind:'island',links:['low-step-left','bottom-step-right']},
  {id:'bottom-step-right',x1:2570,x2:2900,y:4495,depth:260,kind:'island',links:['low-step-right','bottom-step-left']}
]);

const PLATFORM_BY_ID=new Map(HUANCAVELICA_PLATFORMS.map(p=>[p.id,p]));
const SPAWN_PLATFORM_IDS=['left-cliff-top','right-cliff-top','mid-left-high','mid-right-high','center-mid','center-upper','mid-left-low','mid-right-low'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const isHuancavelica=room=>room?.phase10TerrainAlias===HUANCAVELICA_ID||room?.arena?.phase10Theme===HUANCAVELICA_ID;
const platformAt=id=>PLATFORM_BY_ID.get(id)??null;
const publicPlatforms=()=>HUANCAVELICA_PLATFORMS.map(p=>({...p,links:[...p.links]}));

function platformSurface(room,platform,x){const px=clamp(Number(x),platform.x1,platform.x2);return huancavelicaSurfaceNear(room,px,platform.y,Math.max(460,platform.depth*.72))??platform.y;}
function nearestPlatformForPoint(room,x,y){let best=null,bestScore=Infinity;for(const platform of HUANCAVELICA_PLATFORMS){const px=clamp(Number(x),platform.x1,platform.x2),py=platformSurface(room,platform,px),score=Math.abs(px-x)+Math.abs(py-y)*.6;if(score<bestScore){bestScore=score;best={platform,x:px,y:py};}}return best;}
function topPlatformAtX(room,x){const y=huancavelicaTopSurface(room,x);if(y>=WORLD_HEIGHT-1)return null;const nearest=nearestPlatformForPoint(room,x,y);return nearest?{platform:nearest.platform,y}:null;}
function setPlayerMetadataFromPoint(room,player,x,y){const nearest=nearestPlatformForPoint(room,x,y);player.phase10PlatformId=nearest?.platform?.id??null;}

function findWalkTarget(room,from,dir){
  const x=clamp(Number(from.x)+dir*WALK_STEP,40,WORLD_WIDTH-40),feet=Number(from.y)+GROUND_OFFSET;
  const walkSurface=huancavelicaNearestSurface(room,x,feet,{maxRise:MAX_WALK_SURFACE_DELTA,maxDrop:MAX_WALK_SURFACE_DELTA});
  if(walkSurface!=null)return{type:'walk',x,y:Math.round(walkSurface-GROUND_OFFSET),surfaceY:walkSurface};
  const lower=huancavelicaSurfaceBelow(room,x,feet+MAX_WALK_SURFACE_DELTA+.5,WORLD_HEIGHT);
  if(lower!=null)return{type:'fall',x,y:Math.round(lower-GROUND_OFFSET),surfaceY:lower,drop:lower-feet};
  if(huancavelicaSurfacesAtX(room,x).some(surface=>surface<feet-MAX_WALK_SURFACE_DELTA))return{type:'blocked',x};
  return{type:'void',x,y:WORLD_HEIGHT+120};
}
function landingHasRun(room,x,targetSurface,dir){for(const offset of [dir*MIN_LANDING_RUN,-dir*Math.min(18,MIN_LANDING_RUN)]){const y=huancavelicaNearestSurface(room,clamp(x+offset,40,WORLD_WIDTH-40),targetSurface,{maxRise:75,maxDrop:75});if(y==null)return false;}return true;}
function arcIsClear(room,from,toX,toY,apex){for(let i=2;i<47;i+=1){const t=i/48,x=from.x+(toX-from.x)*t,base=from.y+(toY-from.y)*t,y=base-Math.sin(Math.PI*t)*apex;if(isHuancavelicaSolid(room,x,y+GROUND_OFFSET)||isHuancavelicaSolid(room,x,y-VEHICLE_BODY_HEIGHT*.55))return false;}return true;}
function requiredClearApex(room,from,toX,toY){const minimum=Math.max(BASE_APEX,from.y-toY+72);for(let apex=Math.ceil(minimum/25)*25;apex<=MAX_ADAPTIVE_APEX;apex+=25)if(arcIsClear(room,from,toX,toY,apex))return apex;return null;}
function jumpDistances(){const values=[NORMAL_JUMP_DISTANCE];for(let delta=15;delta<=MAX_LINK_JUMP-NORMAL_JUMP_DISTANCE;delta+=15){if(NORMAL_JUMP_DISTANCE-delta>=90)values.push(NORMAL_JUMP_DISTANCE-delta);if(NORMAL_JUMP_DISTANCE+delta<=MAX_LINK_JUMP)values.push(NORMAL_JUMP_DISTANCE+delta);}return[...new Set(values)];}
function findJumpLanding(room,from,dir){
  const feet=Number(from.y)+GROUND_OFFSET,candidates=[];
  for(const distance of jumpDistances()){
    const x=clamp(Number(from.x)+dir*distance,40,WORLD_WIDTH-40);if(Math.abs(x-from.x)<60)continue;
    for(const surface of huancavelicaSurfacesAtX(room,x)){
      const rise=feet-surface,drop=surface-feet;if(rise>MAX_PLATFORM_RISE||drop>MAX_PLATFORM_RISE)continue;if(!landingHasRun(room,x,surface,dir))continue;
      const y=Math.round(surface-GROUND_OFFSET),apex=requiredClearApex(room,from,x,y);if(apex==null)continue;
      candidates.push({x,y,surfaceY:surface,apex,distance:Math.abs(x-from.x),score:Math.abs(distance-NORMAL_JUMP_DISTANCE)+Math.max(0,rise)*.025+Math.max(0,drop)*.01});
    }
    if(candidates.length&&distance===NORMAL_JUMP_DISTANCE)break;
  }
  return candidates.sort((a,b)=>a.score-b.score||a.apex-b.apex)[0]??null;
}

function validateAction(room,player){if(!room)return'not_in_room';if(room.status!=='started')return'match_not_started';if(room.match?.activePlayerId!==player?.id)return'not_your_turn';if(room.match?.projectile)return'shot_in_flight';if(!player?.spawn||player?.alive===false)return'player_missing';if(player?.motion&&Date.now()<Number(player.motion.endsAt??0))return'player_in_motion';return null;}
function snapPickupsToMask(room){if(!isHuancavelica(room))return;for(const box of room.pickups??[]){const target=Number(box.y)+24,surface=huancavelicaNearestSurface(room,Number(box.x),target,{maxRise:900,maxDrop:1800})??huancavelicaTopSurface(room,Number(box.x));if(surface<WORLD_HEIGHT-1)box.y=Math.round(surface-24);}}
function collectAfterCustomMotion(room,player,id){phase9AirPickupTestHooks.collectOneAlongMotion?.(room,player,id);phase9TestHooks.collectOneByTouch?.(room,player);phase9TestHooks.maintainPhase9Pickups?.(room);snapPickupsToMask(room);}
function beginVoidFall(room,player,from,x,dir,type='fall'){const now=Date.now(),endsAt=now+VOID_FALL_MS;player.hp=0;player.alive=false;player.spawn={x,y:WORLD_HEIGHT+120,facing:dir};player.motion={type,startedAt:now,endsAt,fromX:from.x,fromY:from.y,toX:x,toY:WORLD_HEIGHT+120,apex:type==='jump'?BASE_APEX:0};room.match.turnEndsAt=endsAt+VOID_FINISH_BUFFER_MS;return{ok:true,room,voidFall:true};}

function moveOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};const dir=Number(direction)<0?-1:Number(direction)>0?1:0;if(!dir)return{ok:false,error:'invalid_direction'};
  const from={...player.spawn},target=findWalkTarget(room,from,dir);if(target.type==='blocked')return{ok:false,error:'terrain_too_steep'};if(target.type==='void')return beginVoidFall(room,player,from,target.x,dir,'fall');
  const now=Date.now();player.spawn={x:target.x,y:target.y,facing:dir};setPlayerMetadataFromPoint(room,player,target.x,target.surfaceY);
  if(target.type==='fall'){const duration=Math.round(clamp(Math.max(0,target.drop)*2.2,NATURAL_DROP_MIN_MS,NATURAL_DROP_MAX_MS));player.motion={type:'fall',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:target.x,toY:target.y,apex:0,naturalLedgeDrop:true,bitmapMaskTraversal:true};}
  else player.motion={type:'move',startedAt:now,endsAt:now+MOVE_VISUAL_MS,fromX:from.x,fromY:from.y,toX:target.x,toY:target.y,apex:0,bitmapMaskTraversal:true};
  collectAfterCustomMotion(room,player,id);return{ok:true,room,bitmapMaskTraversal:true};
}
function jumpOnHuancavelica(id,direction){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);installHuancavelicaArena(room);const error=validateAction(room,player);if(error)return{ok:false,error};const dir=Number(direction)<0?-1:Number(direction)>0?1:(player.spawn?.facing||1),from={...player.spawn},landing=findJumpLanding(room,from,dir);
  if(!landing){const x=clamp(from.x+dir*NORMAL_JUMP_DISTANCE,40,WORLD_WIDTH-40);return beginVoidFall(room,player,from,x,dir,'jump');}
  const now=Date.now(),duration=Math.round(clamp(JUMP_DURATION_MS+(landing.distance-NORMAL_JUMP_DISTANCE)*.55,520,820));player.spawn={x:landing.x,y:landing.y,facing:dir};setPlayerMetadataFromPoint(room,player,landing.x,landing.surfaceY);player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:landing.x,toY:landing.y,apex:landing.apex,bitmapMaskTraversal:true};collectAfterCustomMotion(room,player,id);return{ok:true,room,bitmapMaskTraversal:true};
}

function installHuancavelicaArena(room){
  if(!isHuancavelica(room)||!room?.arena)return room;
  room.arena.phase10Theme=HUANCAVELICA_ID;room.arena.terrainName=HUANCAVELICA_NAME;room.arena.collisionModel='bitmap-alpha-mask-v1';room.arena.platforms=publicPlatforms();room.arena.voidFloor=true;room.arena.legacyCollisionBase=COLLISION_BASE;room.arena.bitmapTerrain={width:HUANCAVELICA_IMAGE_WIDTH,height:HUANCAVELICA_IMAGE_HEIGHT,worldWidth:WORLD_WIDTH,worldHeight:WORLD_HEIGHT,alphaThreshold:HUANCAVELICA_ALPHA_THRESHOLD,maskSource:'terrain-alpha'};
  const count=Math.max(1,room.players.length);
  room.players.forEach((player,index)=>{if(player.phase10PlatformId||player.phase10BitmapSpawned)return;const platform=platformAt(SPAWN_PLATFORM_IDS[index%SPAWN_PLATFORM_IDS.length]);if(!platform)return;const lane=(index+1)/(count+1),x=Math.round(platform.x1+(platform.x2-platform.x1)*clamp(lane,.18,.82)),surface=platformSurface(room,platform,x);player.phase10PlatformId=platform.id;player.phase10BitmapSpawned=true;player.spawn={x,y:Math.round(surface-GROUND_OFFSET),facing:x<WORLD_WIDTH/2?1:-1};player.motion=null;});
  snapPickupsToMask(room);return room;
}

function firstPlatformImpact(room,q,maxSeconds=8){const impact=firstHuancavelicaMaskImpact(room,q,maxSeconds);if(!impact)return null;const platform=nearestPlatformForPoint(room,impact.x,impact.y)?.platform;return{...impact,platformId:platform?.id??null};}
function applyImpact(q,impact){if(!q||!impact)return false;const candidateAt=Number(q.startedAt)+Math.round(impact.t*1000);if(q.impactReason==='player'&&Number(q.impactAt)<=candidateAt)return false;q.impactReason='terrain';q.hitPlayerId=null;q.impactX=impact.x;q.impactY=impact.y;q.durationMs=Math.max(220,Math.round(impact.t*1000));q.impactAt=Number(q.startedAt)+q.durationMs;q.phase10PlatformId=impact.platformId;return true;}
function adjustProjectileToPlatforms(room,q){
  if(!q)return false;let changed=false;
  if(q.weaponType==='airstrike'){for(const shell of q.airStrikeShells??[]){const surface=huancavelicaTopSurface(room,Number(shell.x));if(surface<WORLD_HEIGHT-1){shell.y=surface;shell.phase10PlatformId=nearestPlatformForPoint(room,shell.x,surface)?.platform?.id??null;changed=true;}}return changed;}
  if(q.weaponType==='triple'&&Array.isArray(q.volley)){for(const shot of q.volley){const impact=firstPlatformImpact(room,shot);if(impact)changed=applyImpact(shot,impact)||changed;}q.specialResolveAt=Math.max(...q.volley.map(v=>Number(v.impactAt??0)));q.resolveAt=q.specialResolveAt+900;return changed;}
  const oldX=Number(q.impactX),oldY=Number(q.impactY),impact=firstPlatformImpact(room,q);if(impact)changed=applyImpact(q,impact)||changed;
  if(q.weaponType==='cluster'&&changed){const parentY=Number(q.impactY),dx=Number(q.impactX)-oldX;q.clusterImpacts=(q.clusterImpacts??[]).map((child,index)=>{const x=clamp(Number(child.x)+dx,0,WORLD_WIDTH),surface=huancavelicaSurfaceBelow(room,x,parentY-20,WORLD_HEIGHT)??huancavelicaTopSurface(room,x),y=surface<WORLD_HEIGHT-1?surface:clamp(Number(child.y)+(Number(q.impactY)-oldY),100,WORLD_HEIGHT);return{...child,x,y,phase10PlatformId:nearestPlatformForPoint(room,x,y)?.platform?.id??null,visualStartAt:q.impactAt+667+index*167,impactAt:q.impactAt+667+index*167+1333};});q.specialResolveAt=Math.max(...q.clusterImpacts.map(v=>v.impactAt));q.resolveAt=q.specialResolveAt+900;}
  else if(q.weaponType==='nuke'&&changed){q.targetX=q.impactX;q.targetY=q.impactY;if(q.nukeBeam)q.nukeBeam={...q.nukeBeam,bx:q.impactX,by:q.impactY};q.targetLockedAt=q.impactAt;q.warningUntil=q.impactAt+5000;q.beamAt=q.warningUntil;q.beamUntil=q.beamAt+5000;q.resolveAt=q.beamUntil+1500;}
  else if(changed)q.resolveAt=Math.max(Number(q.resolveAt??0),q.impactAt+900);return changed;
}
function projectileImpactHints(room,q){const hints=[];const add=entry=>{if(!entry)return;const x=Number(entry.x??entry.impactX),y=Number(entry.y??entry.impactY);if(!Number.isFinite(x)||!Number.isFinite(y))return;hints.push({x,y,platformId:entry.phase10PlatformId??nearestPlatformForPoint(room,x,y)?.platform?.id??null});};add(q);for(const v of q?.volley??[])add(v);for(const v of q?.clusterImpacts??[])add(v);for(const v of q?.airStrikeShells??[])add(v);return hints;}
function bindCraterToPlatform(room,crater,hints=[]){if(Number.isFinite(Number(crater.y)))return crater;const x=Number(crater.x),ranked=hints.map(h=>({...h,score:Math.abs(h.x-x)})).sort((a,b)=>a.score-b.score),hint=ranked[0],surface=hint?.y??huancavelicaTopSurface(room,x);if(Number.isFinite(surface)&&surface<WORLD_HEIGHT){crater.y=Math.round(surface);crater.phase10PlatformId=hint?.platformId??nearestPlatformForPoint(room,x,surface)?.platform?.id??null;}return crater;}
function bindNewCraters(room,knownIds,hints){for(const crater of room?.arena?.craters??[])if(!knownIds.has(crater.id)||!Number.isFinite(Number(crater.y)))bindCraterToPlatform(room,crater,hints);}

function fireOnHuancavelica(id){const room=findRoomBySocket(id);installHuancavelicaArena(room);const result=baseFireProjectile9(id);if(result?.ok&&isHuancavelica(result.room)){installHuancavelicaArena(result.room);adjustProjectileToPlatforms(result.room,result.room.match?.projectile);}return result;}
function advanceOnHuancavelica(code,now=Date.now()){const room=getRoom(code),knownIds=new Set(room?.arena?.craters?.map(c=>c.id)??[]),hints=projectileImpactHints(room,room?.match?.projectile),changed=baseAdvanceTurnIfDue9(code,now),target=changed??room;if(target&&isHuancavelica(target)){bindNewCraters(target,knownIds,hints);installHuancavelicaArena(target);snapPickupsToMask(target);}return changed;}

function decoratePublicState(room,state){
  const presets=[...(state?.terrainPresets??[])];if(!presets.some(entry=>entry.id===HUANCAVELICA_ID))presets.push({id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME});state.terrainPresets=presets;
  if(isHuancavelica(room)){installHuancavelicaArena(room);state=basePublicRoomState9(room);state.terrainPresets=presets;state.terrainPreset=HUANCAVELICA_ID;state.arena={...(state.arena??{}),terrainPreset:HUANCAVELICA_ID,terrainName:HUANCAVELICA_NAME,phase10Theme:HUANCAVELICA_ID,collisionModel:'bitmap-alpha-mask-v1',platforms:publicPlatforms(),voidFloor:true,legacyCollisionBase:COLLISION_BASE,bitmapTerrain:{width:HUANCAVELICA_IMAGE_WIDTH,height:HUANCAVELICA_IMAGE_HEIGHT,worldWidth:WORLD_WIDTH,worldHeight:WORLD_HEIGHT,alphaThreshold:HUANCAVELICA_ALPHA_THRESHOLD,maskSource:'terrain-alpha'}};state.players=(state.players??[]).map(p=>({...p,phase10PlatformId:room.players.find(source=>source.id===p.id)?.phase10PlatformId??null}));state.phase10Map={id:HUANCAVELICA_ID,name:HUANCAVELICA_NAME,visualTheme:'authored-wild-ones-bitmap-layers',collisionModel:'bitmap-alpha-mask-v1',movementAuthority:'bitmap-mask',platformGraphRole:'spawn-and-navigation-metadata-only',platformCount:HUANCAVELICA_PLATFORMS.length,freeMovement:true,normalJumpDistance:NORMAL_JUMP_DISTANCE,adaptiveMaxDistance:MAX_LINK_JUMP,adaptiveMaxApex:MAX_ADAPTIVE_APEX,assetWidth:HUANCAVELICA_IMAGE_WIDTH,assetHeight:HUANCAVELICA_IMAGE_HEIGHT,maskSource:'terrain-alpha',productionReady:true};}
  return state;
}
export function publicRoomState9(room){if(isHuancavelica(room))installHuancavelicaArena(room);return decoratePublicState(room,basePublicRoomState9(room));}
export function setTerrain9(id,terrain){if(typeof terrain!=='string')return{ok:false,error:'invalid_terrain'};const requested=terrain.toLowerCase(),huancavelica=requested===HUANCAVELICA_ID,result=baseSetTerrain9(id,huancavelica?COLLISION_BASE:requested);if(!result.ok)return result;result.room.phase10TerrainAlias=huancavelica?HUANCAVELICA_ID:null;result.room.phase10MapRevision=huancavelica?'10f-mask-native-traversal':null;for(const player of result.room.players??[]){player.phase10PlatformId=null;player.phase10BitmapSpawned=false;player.ready=false;}return result;}
export function moveActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?moveOnHuancavelica(id,direction):baseMoveActivePlayer9(id,direction);}
export function jumpActivePlayer9(id,direction){const room=findRoomBySocket(id);return isHuancavelica(room)?jumpOnHuancavelica(id,direction):baseJumpActivePlayer9(id,direction);}
export function fireProjectile9(id){const room=findRoomBySocket(id);return isHuancavelica(room)?fireOnHuancavelica(id):baseFireProjectile9(id);}
export function advanceTurnIfDue9(code,now=Date.now()){return advanceOnHuancavelica(code,now);}
export function rematchRoom9(id,options={}){const room=findRoomBySocket(id),keepAlias=room?.phase10TerrainAlias===HUANCAVELICA_ID&&!options?.randomMap,result=baseRematchRoom9(id,options);if(result?.ok){result.room.phase10TerrainAlias=keepAlias?HUANCAVELICA_ID:null;result.room.phase10MapRevision=keepAlias?'10f-mask-native-traversal':null;for(const player of result.room.players??[]){player.phase10PlatformId=null;player.phase10BitmapSpawned=false;}if(keepAlias)installHuancavelicaArena(result.room);}return result;}

export {disconnectPlayer9,phase9AirPickupTestHooks,phase9TestHooks,phase9TraversalTestHooks,selectItem9,setAim9};
export const phase10HuancavelicaTestHooks=Object.freeze({HUANCAVELICA_ID,HUANCAVELICA_NAME,COLLISION_BASE,HUANCAVELICA_PLATFORMS,decoratePublicState,installHuancavelicaArena,platformSurface,topPlatformAtX,nearestPlatformForPoint,firstPlatformImpact,adjustProjectileToPlatforms,projectileImpactHints,bindCraterToPlatform,bindNewCraters,isHuancavelicaSolid,huancavelicaTopSurface,findWalkTarget,findJumpLanding,landingHasRun,requiredClearApex,arcIsClear});
