import {
  findRoomBySocket,
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
const MIN_VISIBLE_PROJECTILE_MS = 1000;
const CLUSTER_CHILD_DELAY_MS = 650;
const CLUSTER_CHILD_STAGGER_MS = 140;

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

function stopJumpAtTerrain(room, player, from, originalMotion, inventoryBefore){
  if(!originalMotion||originalMotion.type!=='jump'||originalMotion.toY>WORLD_HEIGHT)return false;
  const toX=originalMotion.toX,toY=originalMotion.toY,dir=Math.sign(toX-from.x)||1,steps=36;
  let previousX=from.x;
  for(let i=1;i<steps;i+=1){
    const t=i/steps;
    const x=from.x+(toX-from.x)*t;
    const base=from.y+(toY-from.y)*t;
    const y=base-Math.sin(Math.PI*t)*(originalMotion.apex||JUMP_APEX);
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
      player.motion={type:'jump',startedAt:now,endsAt:now+duration,fromX:from.x,fromY:from.y,toX:safeX,toY:safeY,apex:Math.min(originalMotion.apex||JUMP_APEX,Math.max(45,(originalMotion.apex||JUMP_APEX)*fraction))};
      restoreInventorySnapshot(room,player,inventoryBefore);
      return true;
    }
    previousX=x;
  }
  return false;
}

function slowBallistic(v){
  if(!v||!Number.isFinite(v.startedAt)||!Number.isFinite(v.impactAt))return 0;
  const oldDuration=Math.max(1,v.impactAt-v.startedAt);
  if(oldDuration>=MIN_VISIBLE_PROJECTILE_MS)return 0;
  const scale=MIN_VISIBLE_PROJECTILE_MS/oldDuration;
  v.vx=Number(v.vx||0)/scale;
  v.vy=Number(v.vy||0)/scale;
  v.gravity=Number(v.gravity||0)/(scale*scale);
  v.windAccel=Number(v.windAccel||0)/(scale*scale);
  v.durationMs=MIN_VISIBLE_PROJECTILE_MS;
  v.impactAt=v.startedAt+MIN_VISIBLE_PROJECTILE_MS;
  return v.impactAt-(v.startedAt+oldDuration);
}

function paceProjectile(room){
  const q=room?.match?.projectile;
  if(!q||q.visualPacing7A)return;
  q.visualPacing7A=true;
  const type=q.weaponType||'basic';
  if(type==='airstrike')return;
  const oldImpact=q.impactAt;
  const delta=slowBallistic(q);
  if(type==='triple'&&Array.isArray(q.volley)){
    for(const v of q.volley)slowBallistic(v);
    q.specialResolveAt=Math.max(...q.volley.map(v=>v.impactAt));
    q.resolveAt=q.specialResolveAt+900;
  }else if(type==='cluster'){
    if(Array.isArray(q.clusterImpacts))q.clusterImpacts=q.clusterImpacts.map((child,index)=>({...child,impactAt:q.impactAt+CLUSTER_CHILD_DELAY_MS+index*CLUSTER_CHILD_STAGGER_MS}));
    q.specialResolveAt=q.clusterImpacts?.length?Math.max(...q.clusterImpacts.map(v=>v.impactAt)):q.impactAt;
    q.resolveAt=q.specialResolveAt+900;
  }else if(type==='nuke'){
    const shift=q.impactAt-oldImpact;
    if(shift){
      if(Number.isFinite(q.targetLockedAt))q.targetLockedAt+=shift;
      if(Number.isFinite(q.warningUntil))q.warningUntil+=shift;
      if(Number.isFinite(q.beamAt))q.beamAt+=shift;
      if(Number.isFinite(q.beamUntil))q.beamUntil+=shift;
      if(Number.isFinite(q.resolveAt))q.resolveAt+=shift;
    }
  }else q.resolveAt=q.impactAt+900;
  if(type!=='nuke'&&delta&&Number.isFinite(q.resolveAt)&&q.resolveAt<q.impactAt+1)q.resolveAt=q.impactAt+900;
  if(Number.isFinite(q.resolveAt))room.match.turnEndsAt=q.resolveAt;
}

export function publicRoomState7AHotfix(room){
  const state=basePublic(room);
  state.players=state.players.map(pp=>({...pp,connected:room.players.find(p=>p.id===pp.id)?.connected!==false}));
  state.qaHardening={jumpArcCollision:true,disconnectDoesNotAwardVictory:true,minProjectileFlightMs:MIN_VISIBLE_PROJECTILE_MS,clusterChildDelayMs:CLUSTER_CHILD_DELAY_MS};
  return state;
}
export function advanceTurnIfDue7AHotfix(code,now=Date.now()){return baseAdvance(code,now);}
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

export function disconnectPlayer7AHotfix(socketId){
  const room=findRoomBySocket(socketId);
  if(!room)return null;
  if(!['started','countdown'].includes(room.status))return removePlayerBase(socketId);
  const player=room.players.find(p=>p.id===socketId);
  if(!player)return null;
  player.connected=false;
  const order=room.match?.turnOrder??[];
  const removedIndex=order.indexOf(socketId);
  const wasActive=room.match?.activePlayerId===socketId;
  if(removedIndex>=0){
    order.splice(removedIndex,1);
    if(room.match.turnIndex>removedIndex)room.match.turnIndex-=1;
    else if(room.match.turnIndex>=order.length)room.match.turnIndex=Math.max(0,order.length-1);
  }
  if(room.hostId===socketId){const replacement=room.players.find(p=>p.id!==socketId&&p.connected!==false);if(replacement)room.hostId=replacement.id;}
  if(wasActive&&!room.match?.projectile){room.match.activePlayerId=null;room.match.turnEndsAt=Date.now();}
  return {deleted:false,roomCode:room.code,room,disconnected:true};
}

export function rematchRoom7AHotfix(id,options={}){
  const room=findRoomBySocket(id);
  if(!room)return{ok:false,error:'not_in_room'};
  if(room.hostId!==id)return{ok:false,error:'host_only'};
  room.players=room.players.filter(p=>p.connected!==false);
  if(room.players.length<2)return{ok:false,error:'not_enough_players'};
  for(const p of room.players)p.connected=true;
  return baseRematch(id,options);
}

export const phase7aHotfixTestHooks=Object.freeze({surface,paceProjectile,stopJumpAtTerrain});
