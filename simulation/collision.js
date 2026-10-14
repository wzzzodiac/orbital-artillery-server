// Pure collision contract. Identical distribution in server and browser.
export const VEHICLE_HITBOX=Object.freeze({radius:51,centerYOffset:-10});
export const VEHICLE_BODY=Object.freeze({halfWidth:45,top:-59,feet:8,visualWidth:109.2,visualHeight:58.5});
export const PROJECTILE_RULES=Object.freeze({dt:.02,maxSeconds:8,ownerGraceSeconds:.14});
export function ballisticPoint(s,t){return{x:s.startX+(s.vx??0)*t+.5*(s.windAccel??0)*t*t,y:s.startY+(s.vy??0)*t+.5*(s.gravity??0)*t*t};}
export function craterCutsPixel(c,px,py,scale){
  const x=(px+.5)*scale,y=(py+.5)*scale,r=Number(c?.radius);
  return [Number(c?.x),Number(c?.y),r].every(Number.isFinite)&&r>0&&(x-c.x)**2+(y-c.y)**2<=r*r;
}
export function sweptVehicleContact(players,from,to,ownerId,ignoreOwner=false,minimumOwnerT=0){
  let first=null;
  for(const p of players??[]){
    if(!p.spawn||p.alive===false||(p.id===ownerId&&ignoreOwner))continue;
    const dx=to.x-from.x,dy=to.y-from.y,ox=from.x-p.spawn.x,oy=from.y-(p.spawn.y+VEHICLE_HITBOX.centerYOffset);
    const a=dx*dx+dy*dy,b=2*(ox*dx+oy*dy),c=ox*ox+oy*oy-VEHICLE_HITBOX.radius**2,disc=b*b-4*a*c;
    let t=c<=0?0:a>0&&disc>=0?(-b-Math.sqrt(disc))/(2*a):Infinity;
    if(p.id===ownerId&&t<minimumOwnerT){
      const mx=ox+dx*minimumOwnerT,my=oy+dy*minimumOwnerT;
      if(mx*mx+my*my>VEHICLE_HITBOX.radius**2)continue;
      t=minimumOwnerT;
    }
    if(t>=0&&t<=1&&(!first||t<first.t||(t===first.t&&String(p.id)<String(first.targetPlayerId))))first={t,targetPlayerId:p.id};
  }
  return first;
}
export function projectileMuzzle(shot,isSolid){
  const out={...shot},length=Math.max(1,Math.hypot(shot.vx??0,shot.vy??0));
  if(isSolid(shot.startX,shot.startY))for(let distance=4;distance<=96;distance+=4){
    const x=shot.startX+shot.vx/length*distance,y=shot.startY+shot.vy/length*distance;
    if(!isSolid(x,y)){out.startX=x;out.startY=y;break;}
  }
  return out;
}
export function createAimFlight(player,angle,power,wind=0){
  const r=angle*Math.PI/180,speed=320+power*9,facing=player.spawn.facing||1;
  return {startX:player.spawn.x+facing*24,startY:player.spawn.y-24,vx:Math.cos(r)*speed*facing,vy:-Math.sin(r)*speed,gravity:480,windAccel:wind*1.5,collisionTimeScale:1,ownerLaunchSpawn:{...player.spawn}};
}
// Cinematic pacing reparametrizes time, never changes the path or step grid.
// First terrain/player contact is compared within the SAME swept segment.
export function traceFlight(shot,{players=[],ownerId,firstSolid,width=5000,height=3750,fromSeconds=0}){
  const scale=shot.collisionTimeScale??1,dt=PROJECTILE_RULES.dt*scale,max=PROJECTILE_RULES.maxSeconds*scale;
  const owner=players.find(p=>p.id===ownerId);let ignoreUntil=PROJECTILE_RULES.ownerGraceSeconds*scale;
  const ownerSpawn=shot.ownerLaunchSpawn??owner?.spawn;
  if(ownerSpawn){
    for(let i=0;i<=400;i++){
      const t=i*dt,p=ballisticPoint(shot,t);
      if(Math.hypot(p.x-ownerSpawn.x,p.y-(ownerSpawn.y+VEHICLE_HITBOX.centerYOffset))>VEHICLE_HITBOX.radius){ignoreUntil=Math.max(PROJECTILE_RULES.ownerGraceSeconds*scale,t);break;}
      ignoreUntil=max+dt;
    }
  }
  const start=Math.max(0,fromSeconds);let previous=ballisticPoint(shot,start),previousT=start;
  // Resume on the original flight grid after an earlier impact changes terrain.
  for(let i=Math.floor(start/dt)+1;i<=400;i++){
    const t=i*dt,point=ballisticPoint(shot,t),terrain=firstSolid(previous,point);
    const ownerMinimumT=Math.max(0,Math.min(1,(ignoreUntil-previousT)/(t-previousT)));
    const player=sweptVehicleContact(players,previous,point,ownerId,t<ignoreUntil,ownerMinimumT);
    const hit=player&&(!terrain||player.t<terrain.t)?{...player,type:'player'}:terrain?{...terrain,type:'terrain'}:null;
    if(hit)return{x:previous.x+(point.x-previous.x)*hit.t,y:previous.y+(point.y-previous.y)*hit.t,seconds:previousT+(t-previousT)*hit.t,type:hit.type,targetPlayerId:hit.targetPlayerId??null};
    if(point.x<0||point.x>width||point.y>height+120)return{...point,seconds:t,type:'out_of_bounds',targetPlayerId:null};
    previous=point;previousT=t;
  }
  return {...previous,seconds:max,type:'timeout',targetPlayerId:null};
}
