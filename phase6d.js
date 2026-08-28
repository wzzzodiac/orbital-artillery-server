import { randomInt } from 'node:crypto';
import { findRoomBySocket, getRoom } from './rooms.js';
import {
  advanceTurnIfDue6A as baseAdvance,
  fireProjectile6A as baseFire,
  jumpActivePlayer6A as baseJump,
  moveActivePlayer6A as baseMove,
  publicRoomState6A as basePublic,
  selectItem6A as baseSelect
} from './phase6c.js';

const MAX_HP = 100;
const NUKE_WEIGHT = 3;
const PHASE6C_POOL_WEIGHT = 123;
const FULL_POOL_WEIGHT = PHASE6C_POOL_WEIGHT + NUKE_WEIGHT;
const NUKE_DAMAGE = 20;
const NUKE_WARNING_MS = 3000;
const NUKE_BEAM_MS = 3000;
const NUKE_RESOLVE_BUFFER_MS = 1500;
const NUKE_HALF_LENGTH = 900;
const NUKE_BEAM_HALF_WIDTH = 115;
const NUKE_BEAM_VERTICAL_HALF_SPAN = 320;
const NUKE_CUT_RADIUS = 145;
const NUKE_CUT_DEPTH = 4200;
const NUKE_CUT_STEP = 105;
const FREE_JUMP_COOLDOWN_MS = 450;
const FREE_JUMP_VISUAL_MS = 500;
const GROUND_OFFSET = 8;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;

const HOLES={rolling:[],terraces:[[2430,2550]],twinpeaks:[[2390,2510]],basin:[[1140,1240],[3760,3860]],brokenridge:[[1010,1140],[2410,2550],[3860,3980]],islands:[[900,1040],[1920,2080],[2910,3070],[3960,4110]],canyon:[[2380,2580]]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const gaussian=(x,c,w,a)=>a*Math.exp(-((x-c)**2)/w);
const plateau=(x,l,r,y,f)=>x>=l&&x<=r?y:f;
function baseY(p,x){switch(p){case'terraces':{let y=3520+Math.sin(x/560)*100;y=plateau(x,330,900,3190,y);y=plateau(x,1040,1640,2920,y);y=plateau(x,1770,2350,3250,y);y=plateau(x,2630,3260,2820,y);y=plateau(x,3390,3970,3110,y);return plateau(x,4110,4680,2870,y);}case'twinpeaks':{let y=3650-gaussian(x,1200,260000,850)-gaussian(x,3820,300000,900)+Math.sin(x/280)*60;if(x>650&&x<980)y=3000;if(x>1510&&x<1850)y=3170;if(x>3150&&x<3460)y=3090;if(x>4050&&x<4410)y=2890;return y;}case'basin':{let y=2870+gaussian(x,2500,850000,690)+Math.sin(x/410)*65;if(x>420&&x<950)y=2750;if(x>1320&&x<1760)y=3160;if(x>3240&&x<3680)y=3160;if(x>4050&&x<4580)y=2750;return y;}case'brokenridge':{let y=3490+Math.sin(x/210)*170+Math.sin(x/690+1.1)*130;if(x>420&&x<900)y=3070;if(x>1260&&x<1720)y=2740;if(x>1900&&x<2320)y=3260;if(x>2700&&x<3160)y=2860;if(x>3330&&x<3770)y=3180;if(x>4140&&x<4620)y=2780;return y;}case'islands':if(x<900)return 3100-gaussian(x,520,90000,260);if(x<1920)return 2840-gaussian(x,1470,125000,190);if(x<2910)return 3260-gaussian(x,2480,130000,320);if(x<3960)return 2760-gaussian(x,3470,135000,220);return 3160-gaussian(x,4540,100000,280);case'canyon':{let y=2920+Math.min(Math.abs(x-2500)*.28,700);if(x>420&&x<980)y=2700;if(x>1120&&x<1640)y=3030;if(x>1800&&x<2260)y=3380;if(x>2740&&x<3200)y=3380;if(x>3360&&x<3880)y=3030;if(x>4020&&x<4580)y=2700;return y;}default:{let y=3440+Math.sin(x/470)*165+Math.sin(x/980+.7)*95;if(x>700&&x<1120)y=3140;if(x>1760&&x<2140)y=2920;if(x>2840&&x<3240)y=3170;if(x>3890&&x<4320)y=2860;return y;}}}
function surface(room,x){const px=clamp(x,0,WORLD_WIDTH),p=room.terrainPreset||'rolling';if((HOLES[p]||[]).some(([l,r])=>px>=l&&px<=r))return WORLD_HEIGHT;let y=baseY(p,px);for(const c of room.arena?.craters||[]){const dx=Math.abs(px-c.x);if(dx<c.radius)y+=c.depth*Math.sqrt(Math.max(0,1-(dx/c.radius)**2));}return clamp(y,120,WORLD_HEIGHT);}

function resultFor(room){const alive=room.players.filter(p=>p.alive!==false);if(room.mode==='survival'){if(alive.length>1)return null;return{type:'survival',winnerPlayerId:alive[0]?.id??null,winnerName:alive[0]?.name??null,draw:alive.length===0};}const teams=[...new Set(alive.map(p=>p.team))];if(teams.length>1)return null;return{type:'team',winnerTeam:teams[0]??null,draw:teams.length===0};}
function distanceToSegment(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;if(len2<=.0001)return Math.hypot(px-ax,py-ay);const t=clamp(((px-ax)*dx+(py-ay)*dy)/len2,0,1);return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));}
function rollNukeForNewPickup(room){
  if(!room?.match||!Array.isArray(room.pickups))return false;
  const turn=room.match.turnNumber??0;
  let changed=false;
  for(const box of room.pickups){
    if(box.spawnTurn!==turn||box.phase6dPoolRolled)continue;
    box.phase6dPoolRolled=true;
    if(randomInt(FULL_POOL_WEIGHT)<NUKE_WEIGHT){box.type='nuke';box.label='NUKE LASER';changed=true;}
  }
  return changed;
}

function publicState(room){
  let state=basePublic(room);
  if(rollNukeForNewPickup(room))state=basePublic(room);
  state.phase='6D';
  if(!state.itemPool.some(item=>item.type==='nuke')) state.itemPool=[...state.itemPool,{type:'nuke',label:'NUKE LASER',weight:NUKE_WEIGHT}];
  state.nukeRules={damage:NUKE_DAMAGE,weight:NUKE_WEIGHT,warningMs:NUKE_WARNING_MS,beamMs:NUKE_BEAM_MS,halfLength:NUKE_HALF_LENGTH,beamHalfWidth:NUKE_BEAM_HALF_WIDTH,beamVerticalHalfSpan:NUKE_BEAM_VERTICAL_HALF_SPAN,knockback:false,fullFriendlyFire:true,selfDamage:true,pickups:'destroy'};
  state.movementRules={freeDuringTurn:true,movementRadius:null,jumpsPerTurn:null,jumpCooldownMs:FREE_JUMP_COOLDOWN_MS,shotLocksMovement:true};
  if(state.match)state.match={...state.match,movementOriginX:null,movementRadius:null,jumpsRemaining:null};
  const active=room.players.find(p=>p.id===room.match?.activePlayerId);
  const slot=active?.selectedItemSlot??1;
  const selected=slot>1?active?.inventory?.[slot-2]:null;
  state.spectatorAim={activePlayerId:room.match?.activePlayerId??null,angle:room.match?.aimAngle??45,power:room.match?.aimPower??55,selectedItemType:selected?.type??'basic'};
  if(state.match?.projectile?.weaponType==='nuke') state.match.projectile={...state.match.projectile,nukeBeam:state.match.projectile.nukeBeam?{...state.match.projectile.nukeBeam}:null};
  return state;
}

function prepareNuke(room,q){
  const centerX=clamp(q.impactX,80,WORLD_WIDTH-80);
  const centerY=surface(room,centerX);
  const targetLockedAt=q.impactAt;
  const beamAt=targetLockedAt+NUKE_WARNING_MS;
  const ax=clamp(centerX-NUKE_HALF_LENGTH,30,WORLD_WIDTH-30);
  const bx=clamp(centerX+NUKE_HALF_LENGTH,30,WORLD_WIDTH-30);
  const ay=clamp(centerY-NUKE_BEAM_VERTICAL_HALF_SPAN,80,WORLD_HEIGHT-80);
  const by=clamp(centerY+NUKE_BEAM_VERTICAL_HALF_SPAN,80,WORLD_HEIGHT-80);
  q.weaponType='nuke';
  q.targetX=centerX;
  q.targetY=centerY;
  q.targetLockedAt=targetLockedAt;
  q.warningUntil=beamAt;
  q.beamAt=beamAt;
  q.beamUntil=beamAt+NUKE_BEAM_MS;
  q.nukeApplied=false;
  q.nukeBeam={ax,ay,bx,by,halfWidth:NUKE_BEAM_HALF_WIDTH};
  q.resolveAt=q.beamUntil+NUKE_RESOLVE_BUFFER_MS;
  room.match.turnEndsAt=q.resolveAt;
}

function applyNuke(room,q,now){
  if(q.nukeApplied)return false;
  q.nukeApplied=true;
  const {ax,ay,bx,by}=q.nukeBeam;
  for(const player of room.players){
    if(player.alive===false||!player.spawn)continue;
    const d=distanceToSegment(player.spawn.x,player.spawn.y-10,ax,ay,bx,by);
    if(d>NUKE_BEAM_HALF_WIDTH)continue;
    let damage=NUKE_DAMAGE;
    if(player.shield){damage=Math.max(1,Math.ceil(damage*player.shield.factor));player.shield=null;}
    player.hp=Math.max(0,(player.hp??MAX_HP)-damage);
    player.lastDamage={amount:damage,at:now,sourcePlayerId:q.ownerPlayerId};
    if(player.hp<=0)player.alive=false;
  }

  for(let x=q.targetX-NUKE_HALF_LENGTH,index=0;x<=q.targetX+NUKE_HALF_LENGTH;x+=NUKE_CUT_STEP,index+=1){
    const cx=clamp(x,30,WORLD_WIDTH-30);
    if(surface(room,cx)>=WORLD_HEIGHT-1)continue;
    room.arena.craters.push({id:`${q.id}-nuke-${index}`,x:cx,radius:NUKE_CUT_RADIUS,depth:NUKE_CUT_DEPTH,createdAt:now});
  }

  room.pickups=(room.pickups??[]).filter(box=>distanceToSegment(box.x,box.y,ax,ay,bx,by)>NUKE_BEAM_HALF_WIDTH+45);

  q.pendingVoidDeathIds=[];
  for(const player of room.players){
    if(player.alive===false||!player.spawn)continue;
    const nextY=surface(room,player.spawn.x);
    if(nextY>=WORLD_HEIGHT-1){
      q.pendingVoidDeathIds.push(player.id);
      const fromY=player.spawn.y;
      player.spawn={...player.spawn,y:WORLD_HEIGHT+120};
      player.motion={type:'fall',startedAt:now,endsAt:Math.min(q.resolveAt-60,now+1500),fromX:player.spawn.x,fromY,toX:player.spawn.x,toY:WORLD_HEIGHT+120,apex:0};
      continue;
    }
    const targetY=nextY-GROUND_OFFSET;
    if(targetY>player.spawn.y+2){const fromY=player.spawn.y;player.spawn={...player.spawn,y:targetY};player.motion={type:'fall',startedAt:now,endsAt:Math.min(q.resolveAt-60,now+Math.min(1200,Math.max(350,(targetY-fromY)*2.2))),fromX:player.spawn.x,fromY,toX:player.spawn.x,toY:targetY,apex:0};}
  }
  return true;
}

function advanceNuke(room,now){
  const q=room.match?.projectile;
  if(!q||q.weaponType!=='nuke')return null;
  let changed=false;
  if(!q.nukeApplied&&now>=q.beamAt)changed=applyNuke(room,q,now)||changed;
  if(now<q.resolveAt)return changed?room:null;
  for(const id of q.pendingVoidDeathIds??[]){const player=room.players.find(p=>p.id===id);if(player&&player.alive!==false){player.hp=0;player.alive=false;}}
  room.match.pendingResult=resultFor(room);
  room.match.projectile=null;
  room.match.turnEndsAt=now;
  return baseAdvance(room.code,now)??room;
}

export function fireProjectile6D(socketId){
  const room=findRoomBySocket(socketId);
  if(!room)return{ok:false,error:'not_in_room'};
  const player=room.players.find(p=>p.id===socketId);
  const slot=player?.selectedItemSlot??1;
  const item=slot>1?player?.inventory?.[slot-2]:null;
  const result=baseFire(socketId);
  if(!result.ok)return result;
  if(item?.type==='nuke'){
    const q=result.room.match?.projectile;
    if(!q)return{ok:false,error:'nuke_target_failed'};
    prepareNuke(result.room,q);
    player.lastUtility={type:'nuke',label:'NUKE LASER DESIGNATOR',at:Date.now()};
  }
  return result;
}

function unlockMovementEnvelope(room){
  if(!room?.match)return;
  room.match.movementOriginX=WORLD_WIDTH/2;
  room.match.movementRadius=WORLD_WIDTH;
}
function traversalSnapshot(room){
  if(!room?.match)return null;
  return{movementOriginX:room.match.movementOriginX,movementRadius:room.match.movementRadius,jumpsRemaining:room.match.jumpsRemaining};
}
function restoreTraversal(room,snapshot){
  if(!room?.match||!snapshot)return;
  room.match.movementOriginX=snapshot.movementOriginX;
  room.match.movementRadius=snapshot.movementRadius;
  room.match.jumpsRemaining=snapshot.jumpsRemaining;
}
function exposeFreeTraversal(room){
  if(!room?.match)return;
  room.match.movementOriginX=WORLD_WIDTH/2;
  room.match.movementRadius=WORLD_WIDTH;
  room.match.jumpsRemaining=null;
}

export function publicRoomState6D(room){return publicState(room);}
export function advanceTurnIfDue6D(code,now=Date.now()){const room=getRoom(code);if(room?.match?.projectile?.weaponType==='nuke')return advanceNuke(room,now);return baseAdvance(code,now);}
export function moveActivePlayer6D(socketId,direction){
  const room=findRoomBySocket(socketId);
  const snapshot=traversalSnapshot(room);
  unlockMovementEnvelope(room);
  const result=baseMove(socketId,direction);
  if(!result.ok)restoreTraversal(room,snapshot);
  else exposeFreeTraversal(result.room);
  return result;
}
export function jumpActivePlayer6D(socketId,direction){
  const room=findRoomBySocket(socketId);
  if(!room)return{ok:false,error:'not_in_room'};
  const player=room.players.find(p=>p.id===socketId);
  const now=Date.now();
  if(player?.lastFreeJumpAt&&now-player.lastFreeJumpAt<FREE_JUMP_COOLDOWN_MS)return{ok:false,error:'jump_cooldown'};
  const snapshot=traversalSnapshot(room);
  unlockMovementEnvelope(room);
  if(room.match)room.match.jumpsRemaining=999999;
  const result=baseJump(socketId,direction);
  if(!result.ok){restoreTraversal(room,snapshot);return result;}
  player.lastFreeJumpAt=now;
  if(player.motion?.type==='jump')player.motion.endsAt=player.motion.startedAt+FREE_JUMP_VISUAL_MS;
  exposeFreeTraversal(result.room);
  return result;
}
export function selectItem6D(socketId,slot){return baseSelect(socketId,slot);}
