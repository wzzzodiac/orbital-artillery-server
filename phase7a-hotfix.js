import {
  findRoomBySocket,
  getRoom,
  removePlayer as removePlayerBase
} from './rooms.js';
import {
  advanceTurnIfDue7A1 as baseAdvance,
  fireProjectile7A1 as baseFire,
  jumpActivePlayer7A1 as baseJump,
  moveActivePlayer7A1 as baseMove,
  publicRoomState7A1 as basePublic,
  rematchRoom7A1 as baseRematch,
  selectItem7A1 as baseSelect,
  setAim7A1 as baseAim,
  setTerrain7A1 as baseTerrain
} from './phase7a1.js';

const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const GROUND_OFFSET = 8;
const JUMP_APEX = 150;
const MAX_VAULT_APEX = 850;
const JUMP_CLEARANCE = 16;
const BASIC_MIN_VISIBLE_MS = 4000;
const BOX_WEAPON_MIN_VISIBLE_MS = 4667;
const CLUSTER_CHILD_DELAY_MS = 667;
const CLUSTER_CHILD_STAGGER_MS = 167;
const CLUSTER_CHILD_FLIGHT_MS = 1333;
const NUKE_WARNING_MS = 5000;
const NUKE_BEAM_MS = 5000;
const NUKE_RESOLVE_BUFFER_MS = 1500;

const BOX_PROJECTILE_TYPES = new Set(['heavy','triple','cluster','nuke']);
const HOLES = {
  rolling: [], terraces: [[2430,2550]], twinpeaks: [[2390,2510]],
  basin: [[1140,1240],[3760,3860]], brokenridge: [[1010,1140],[2410,2550],[3860,3980]],
  islands: [[900,1040],[1920,2080],[2910,3070],[3960,4110]], canyon: [[2380,2580]]
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const gaussian=(x,c,w,a)=>a*Math.exp(-((x-c)**2)/w);
const plateau=(x,l,r,y,f)=>x>=l&&x<=r?y:f;
function baseY(p,x){switch(p){case'terraces':{let y=3520+Math.sin(x/560)*100;y=plateau(x,330,900,3190,y);y=plateau(x,1040,1640,2920,y);y=plateau(x,1770,2350,3250,y);y=plateau(x,2630,3260,2820,y);y=plateau(x,3390,3970,3110,y);return plateau(x,4110,4680,2870,y);}case'twinpeaks':{let y=3650-gaussian(x,1200,260000,850)-gaussian(x,3820,300000,900)+Math.sin(x/280)*60;if(x>650&&x<980)y=3000;if(x>1510&&x<1850)y=3170;if(x>3150&&x<3460)y=3090;if(x>4050&&x<4410)y=2890;return y;}case'basin':{let y=2870+gaussian(x,2500,850000,690)+Math.sin(x/410)*65;if(x>420&&x<950)y=2750;if(x>1320&&x<1760)y=3160;if(x>3240&&x<3680)y=3160;if(x>4050&&x<4580)y=2750;return y;}case'brokenridge':{let y=3490+Math.sin(x/210)*170+Math.sin(x/690+1.1)*130;if(x>420&&x<900)y=3070;if(x>1260&&x<1720)y=2740;if(x>1900&&x<2320)y=3260;if(x>2700&&x<3160)y=2860;if(x>3330&&x<3770)y=3180;if(x>4140&&x<4620)y=2780;return y;}case'islands':if(x<900)return 3100-gaussian(x,520,90000,260);if(x<1920)return 2840-gaussian(x,1470,125000,190);if(x<2910)return 3260-gaussian(x,2480,130000,320);if(x<3960)return 2760-gaussian(x,3470,135000,220);return 3160-gaussian(x,4540,100000,280);case'canyon':{let y=2920+Math.min(Math.abs(x-2500)*.28,700);if(x>420&&x<980)y=2700;if(x>1120&&x<1640)y=3030;if(x>1800&&x<2260)y=3380;if(x>2740&&x<3200)y=3380;if(x>3360&&x<3880)y=3030;if(x>4020&&x<4580)y=2700;return y;}default:{let y=3440+Math.sin(x/470)*165+Math.sin(x/980+.7)*95;if(x>700&&x<1120)y=3140;if(x>1760&&x<2140)y=2920;if(x>2840&&x<3240)y=3170;if(x>3890&&x<4320)y=2860;return y;}}}
function surface(room,x){const px=clamp(x,0,WORLD_WIDTH),p=room.terrainPreset||'rolling';if((HOLES[p]||[]).some(([l,r])=>px>=l&&px<=r))return WORLD_HEIGHT;let y=baseY(p,px);for(const c of room.arena?.craters||[]){const dx=Math.abs(px-c.x);if(dx<c.radius)y+=c.depth*Math.sqrt(Math.max(0,1-(dx/c.radius)**2));}return clamp(y,120,WORLD_HEIGHT);}

function inventorySnapshot(room, player){return {inventory:Array.isArray(player.inventory)?player.inventory.map(x=>x?{...x}:null):null,lastPickup:player.lastPickup?{...player.lastPickup}:null,pickups:Array.isArray(room.pickups)?room.pickups.map(x=>({...x})):null};}
function restoreInventorySnapshot(room, player, snapshot){if(snapshot.inventory)player.inventory=snapshot.inventory;if(snapshot.pickups)room.pickups=snapshot.pickups;player.lastPickup=snapshot.lastPickup;}

function requiredVaultApex(room, from, motion){
  const dx=motion.toX-from.x;
  let required=Math.max(JUMP_APEX,from.y-motion.toY+70);
  for(let i=3;i<=33;i+=1){
    const t=i/36;
    const s=Math.sin(Math.PI*t);
    if(s<0.12)continue;
    const x=from.x+dx*t;
    const ground=surface(room,x);
    if(ground>=WORLD_HEIGHT-1)continue;
    const base=from.y+(motion.toY-from.y)*t;
    const limit=ground-GROUND_OFFSET-JUMP_CLEARANCE;
    required=Math.max(required,(base-limit)/s);
  }
  return Math.ceil(required);
}

function stopJumpAtTerrain(room, player, from, originalMotion, inventoryBefore){
  if(!originalMotion||originalMotion.type!=='jump'||originalMotion.toY>WORLD_HEIGHT)return false;
  const neededApex=requiredVaultApex(room,from,originalMotion);
  const apex=Math.min(MAX_VAULT_APEX,Math.max(originalMotion.apex||JUMP_APEX,neededApex));
  originalMotion.apex=apex;
  player.motion.apex=apex;
  const toX=originalMotion.toX,toY=originalMotion.toY,dir=Math.sign(toX-from.x)||1,steps=48;
  let previousX=from.x;
  for(let i=1;i<steps;i+=1){
    const t=i/steps;
    const x=from.x+(toX-from.x)*t;
    const base=from.y+(toY-from.y)*t;
    const y=base-Math.sin(Math.PI*t)*apex;
    const ground=surface(room,x);
    const limit=ground-GROUND_OFFSET;
    if(ground<WORLD_HEIGHT-1&&y>limit-1){
      const safeX=clamp(previousX,40,WORLD_WIDTH-40);
      const safeGround=surface(room,safeX);
      if(safeGround>=WORLD_HEIGHT-1)return false;
      const safeY=Math.round(safeGround-GROUND_OFFSET);
      const now=originalMotion.startedAt;
      const fraction=Math.max(.18,Math.abs(safeX-from.x)/Math.max(1,Math.abs(toX-from.x)));
      const duration=Math.max(220,Math.round((originalMotion.endsAt-originalMotion.startedAt)*fraction));
      player.spawn={x:safeX,y:safeY,facing:dir};
      player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:safeX,toY:safeY,apex:Math.min(apex,Math.max(45,apex*fraction))};
      restoreInventorySnapshot(room,player,inventoryBefore);
      return true;
    }
    previousX=x;
  }
  return false;
}

function ballisticPoint(v,seconds){
  return {x:v.startX+Number(v.vx||0)*seconds+.5*Number(v.windAccel||0)*seconds*seconds,y:v.startY+Number(v.vy||0)*seconds+.5*Number(v.gravity||0)*seconds*seconds};
}
function correctTerrainImpactFace(room,v){
  if(!v||v.impactReason!=='terrain'||!Number.isFinite(v.durationMs)||!Number.isFinite(v.startedAt))return false;
  let hi=Math.max(.09,v.durationMs/1000),lo=Math.max(.081,hi-.06);
  const solid=t=>{const p=ballisticPoint(v,t);return p.x>=0&&p.x<=WORLD_WIDTH&&surface(room,p.x)<WORLD_HEIGHT&&p.y>=surface(room,p.x);};
  if(!solid(hi))return false;
  while(lo>.081&&solid(lo))lo=Math.max(.081,lo-.04);
  if(solid(lo))return false;
  for(let i=0;i<16;i+=1){const mid=(lo+hi)/2;if(solid(mid))hi=mid;else lo=mid;}
  const p=ballisticPoint(v,hi);
  v.impactX=clamp(p.x,0,WORLD_WIDTH);
  v.impactY=p.y;
  v.durationMs=Math.max(220,Math.round(hi*1000));
  v.impactAt=v.startedAt+v.durationMs;
  if(Number.isFinite(v.resolveAt))v.resolveAt=Math.max(v.resolveAt,v.impactAt+900);
  v.terrainImpactFaceCorrected=true;
  return true;
}

function slowBallistic(v,minVisibleMs){
  if(!v||!Number.isFinite(v.startedAt)||!Number.isFinite(v.impactAt))return 0;
  const oldDuration=Math.max(1,v.impactAt-v.startedAt);
  if(oldDuration>=minVisibleMs)return 0;
  const scale=minVisibleMs/oldDuration;
  v.vx=Number(v.vx||0)/scale;
  v.vy=Number(v.vy||0)/scale;
  v.gravity=Number(v.gravity||0)/(scale*scale);
  v.windAccel=Number(v.windAccel||0)/(scale*scale);
  v.durationMs=minVisibleMs;
  v.impactAt=v.startedAt+minVisibleMs;
  return v.impactAt-(v.startedAt+oldDuration);
}

function paceProjectile(room){
  const q=room?.match?.projectile;
  if(!q||q.visualPacing7A)return;
  q.visualPacing7A=true;
  const type=q.weaponType||'basic';
  if(type==='airstrike')return;
  correctTerrainImpactFace(room,q);
  if(Array.isArray(q.volley))for(const v of q.volley)correctTerrainImpactFace(room,v);
  const minVisibleMs=BOX_PROJECTILE_TYPES.has(type)?BOX_WEAPON_MIN_VISIBLE_MS:BASIC_MIN_VISIBLE_MS;
  slowBallistic(q,minVisibleMs);
  if(type==='triple'&&Array.isArray(q.volley)){
    for(const v of q.volley)slowBallistic(v,BOX_WEAPON_MIN_VISIBLE_MS);
    q.specialResolveAt=Math.max(...q.volley.map(v=>v.impactAt));
    q.resolveAt=q.specialResolveAt+900;
  }else if(type==='cluster'){
    if(Array.isArray(q.clusterImpacts))q.clusterImpacts=q.clusterImpacts.map((child,index)=>{const visualStartAt=q.impactAt+CLUSTER_CHILD_DELAY_MS+index*CLUSTER_CHILD_STAGGER_MS;return{...child,visualStartAt,impactAt:visualStartAt+CLUSTER_CHILD_FLIGHT_MS};});
    q.specialResolveAt=q.clusterImpacts?.length?Math.max(...q.clusterImpacts.map(v=>v.impactAt)):q.impactAt;
    q.resolveAt=q.specialResolveAt+900;
  }else if(type==='nuke'){
    q.targetLockedAt=q.impactAt;
    q.warningUntil=q.impactAt+NUKE_WARNING_MS;
    q.beamAt=q.warningUntil;
    q.beamUntil=q.beamAt+NUKE_BEAM_MS;
    q.resolveAt=q.beamUntil+NUKE_RESOLVE_BUFFER_MS;
  }else q.resolveAt=q.impactAt+900;
  if(Number.isFinite(q.resolveAt))room.match.turnEndsAt=q.resolveAt;
}

function contendersByHp(room){return room.players.filter(p=>Number(p.hp??100)>0);}
function shouldContinue(room){const contenders=contendersByHp(room);if(room.mode==='survival')return contenders.length>1;return new Set(contenders.map(p=>p.team)).size>1;}
function normalizeAliveFromHp(room){for(const p of room.players){if(Number(p.hp??100)>0&&p.alive===false)p.alive=true;}}
function clearPrematureResult(room){
  if(!room)return;
  normalizeAliveFromHp(room);
  if(shouldContinue(room)&&room.match?.pendingResult)room.match.pendingResult=null;
  if(shouldContinue(room)&&room.status==='finished'){
    room.status='started';
    room.match.result=null;
    room.match.pendingResult=null;
    room.match.finishedAt=null;
    room.match.projectile=null;
    room.match.activePlayerId=null;
    room.match.turnEndsAt=Date.now();
  }
}

export function publicRoomState7AHotfix(room){
  clearPrematureResult(room);
  const state=basePublic(room);
  state.qaHardening={jumpArcCollision:true,dynamicJumpVault:true,disconnectRemovesPlayer:true,victoryRequiresHpEliminationOrExit:true,terrainFaceProjectileCollision:true,basicMinProjectileFlightMs:BASIC_MIN_VISIBLE_MS,boxWeaponMinProjectileFlightMs:BOX_WEAPON_MIN_VISIBLE_MS,clusterChildDelayMs:CLUSTER_CHILD_DELAY_MS,clusterChildFlightMs:CLUSTER_CHILD_FLIGHT_MS,nukeWarningMs:NUKE_WARNING_MS,nukeBeamMs:NUKE_BEAM_MS};
  return state;
}
export function advanceTurnIfDue7AHotfix(code,now=Date.now()){
  const room=getRoom(code);
  clearPrematureResult(room);
  const changed=baseAdvance(code,now);
  if(changed)clearPrematureResult(changed);
  return changed;
}
export function moveActivePlayer7AHotfix(id,d){return baseMove(id,d);}
export function jumpActivePlayer7AHotfix(id,d){
  const room=findRoomBySocket(id),player=room?.players.find(p=>p.id===id);
  if(!room||!player)return baseJump(id,d);
  const from=player.spawn?{...player.spawn}:null,inventoryBefore=inventorySnapshot(room,player);
  const result=baseJump(id,d);
  if(result.ok&&from&&player.motion?.type==='jump')stopJumpAtTerrain(result.room,player,from,{...player.motion},inventoryBefore);
  return result;
}
export function setAim7AHotfix(id,a,p){return baseAim(id,a,p);}
export function selectItem7AHotfix(id,s){return baseSelect(id,s);}
export function setTerrain7AHotfix(id,t){return baseTerrain(id,t);}
export function fireProjectile7AHotfix(id){const result=baseFire(id);if(result.ok)paceProjectile(result.room);return result;}
export function disconnectPlayer7AHotfix(socketId){return removePlayerBase(socketId);}
export function rematchRoom7AHotfix(id,options={}){return baseRematch(id,options);}

export const phase7aHotfixTestHooks=Object.freeze({surface,paceProjectile,stopJumpAtTerrain,requiredVaultApex,correctTerrainImpactFace,clearPrematureResult,shouldContinue});
