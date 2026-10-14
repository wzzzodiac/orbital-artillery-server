import {createAimFlight,projectileMuzzle,traceFlight} from './collision.js';
export function adjustProjectile(room,q,terrain){
  const {isHuancavelicaV2Solid,firstHuancavelicaV2SolidOnSegment}=terrain;
  if(!q)return false;
  const shots=q.weaponType==='triple'&&Array.isArray(q.volley)?q.volley:[q];
  for(const shot of shots){
    shot.ownerLaunchSpawn={...room.players.find(p=>p.id===q.ownerPlayerId).spawn};
    const physicalSpeed=320+Number(shot.power??q.power??55)*9;
    const oldScale=physicalSpeed/Math.max(.001,Math.hypot(shot.vx,shot.vy));
    shot.vx*=oldScale;shot.vy*=oldScale;shot.gravity*=oldScale**2;shot.windAccel*=oldScale**2;
    shot.collisionTimeScale=1;
    Object.assign(shot,projectileMuzzle(shot,(x,y)=>isHuancavelicaV2Solid(room,x,y)));
    const hit=traceFlight(shot,{players:room.players,ownerId:q.ownerPlayerId,firstSolid:(a,b)=>firstHuancavelicaV2SolidOnSegment(room,a,b)});
    // Preserve the existing minimum visible duration without moving the contact.
    const minimumMs=(q.weaponType??'basic')==='basic'?4000:4667;
    const stretch=hit.seconds>0?Math.max(1,minimumMs/(hit.seconds*1000)):1;
    shot.vx/=stretch;shot.vy/=stretch;shot.gravity/=stretch**2;shot.windAccel/=stretch**2;shot.collisionTimeScale*=stretch;
    Object.assign(shot,{impactX:hit.x,impactY:hit.y,impactReason:hit.type,hitPlayerId:hit.targetPlayerId,
      durationMs:Math.max(0,hit.seconds*stretch*1000),impactAt:shot.startedAt+Math.max(0,hit.seconds*stretch*1000)});
  }
  if(q.weaponType==='triple'){
    const middle=q.volley[1];for(const key of ['startX','startY','vx','vy','gravity','windAccel','collisionTimeScale','impactX','impactY','impactAt','durationMs','impactReason','hitPlayerId'])q[key]=middle[key];
    q.specialResolveAt=Math.max(...q.volley.map(s=>s.impactAt));q.resolveAt=q.specialResolveAt+900;
  }else q.resolveAt=q.impactAt+900;
  room.match.turnEndsAt=q.resolveAt;return true;
}
export function createV2Attack(room,player,{id,startedAt,weaponType='basic',angle=room.match.aimAngle,power=room.match.aimPower},terrain,weapons){
 const shot=a=>({...createAimFlight(player,a,power,room.match.wind?.signed??0),id:id+':'+a,ownerPlayerId:player.id,angle:a,power,startedAt,weaponType});
 const q={...shot(angle),id,pickupCollected:false,resolutionApplied:false};
 if(weaponType==='triple')q.volley=[shot(angle-6),shot(angle),shot(angle+6)];
 if(weaponType==='airstrike'){
  q.warningUntil=startedAt+1200;
  q.airStrikeShells=Array.from({length:7},(_,index)=>({index,x:0,y:0,visualStartAt:q.warningUntil+index*233,applied:false}));
 }
 adjustProjectile(room,q,terrain);weapons.prepareV2Weapon(room,q);return q;
}
