import { firstHuancavelicaV2SolidOnSegment, HUANCAVELICA_V2_WORLD_HEIGHT as height, HUANCAVELICA_V2_WORLD_WIDTH as width } from './huancavelica-v2-bitmap.js';
import {traceFlight} from './simulation/collision.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rules = Object.freeze({
  triple: { damage: 10, kind: 'direct', radius: 0, cutRadius: 78, depth: 78 },
  cluster: { damage: 10, kind: 'direct', radius: 0, cutRadius: 0, depth: 0 },
  child: { damage: 5, kind: 'radial', radius: 150, cutRadius: 70, depth: 70 },
  airstrike: { damage: 5, kind: 'radial', radius: 165, cutRadius: 72, depth: 62 },
  nuke: { damage: 20, kind: 'beam', radius: 115, cutRadius: 118, depth: 330 }
});
export const usesV2MultiImpact = q => ['triple', 'cluster', 'airstrike', 'nuke'].includes(q?.weaponType);
export function weaponPoint(shot, seconds) {
  return { x: shot.startX + (shot.vx ?? 0) * seconds + .5 * (shot.windAccel ?? 0) * seconds ** 2,
    y: shot.startY + (shot.vy ?? 0) * seconds + .5 * (shot.gravity ?? 0) * seconds ** 2 };
}
// A forecast is for presentation only until resolved. Reforecast remaining
// flights after each cut, in time order, against the CURRENT mask and players.
function forecast(room, q, event) {
  if (!event.flight || event.resolved) return;
  event.flight.ownerLaunchSpawn??={...room.players.find(p=>p.id===q.ownerPlayerId)?.spawn};
  const hit=traceFlight(event.flight,{players:room.players,ownerId:q.ownerPlayerId,
    firstSolid:(a,b)=>firstHuancavelicaV2SolidOnSegment(room,a,b),width,height,
    fromSeconds:Math.max(0,((q.contactsThroughAt??event.flight.startedAt)-event.flight.startedAt)/1000)});
  Object.assign(event,{x:hit.x,y:hit.y,impactAt:event.flight.startedAt+hit.seconds*1000,contactType:hit.type,targetPlayerId:hit.targetPlayerId});
  syncPresentation(event);
}
function syncPresentation(event) {
  const shot = event.flight;
  if (!shot) return;
  Object.assign(shot, { id: event.id, impactId: event.id, parentProjectileId: event.parentProjectileId,
    x: event.x, y: event.y, impactX: event.x, impactY: event.y, impactAt: event.impactAt,
    durationMs: event.impactAt - shot.startedAt, impactReason: event.contactType, hitPlayerId: event.targetPlayerId,
    resolved: event.resolved });
}
function contact(q, suffix, rule, data, flight = null) {
  return { id: `${q.id}:${suffix}`, attackId: q.id, weaponType: q.weaponType, ownerPlayerId: q.ownerPlayerId,
    parentProjectileId: q.id, contactType: 'pending', targetPlayerId: null, resolved: false,
    damageRule: { ...rule }, terrainCuts: [], damageResults: [], ...data, flight };
}
function clusterLaunch(q,dx,index){
  const incoming=weaponPoint(q,Math.max(0,q.durationMs/1000-.02));
  const length=Math.max(1,Math.hypot(incoming.x-q.impactX,incoming.y-q.impactY));
  const startedAt=q.impactAt+667+index*167;
  return {index,startX:q.impactX+(incoming.x-q.impactX)/length*6,startY:q.impactY+(incoming.y-q.impactY)/length*6,
    vx:dx/1.333,vy:-570,gravity:1140/1.333,windAccel:0,startedAt,visualStartAt:startedAt,bitmapFlight:true};
}
export function prepareV2Weapon(room, q) {
  if (!usesV2MultiImpact(q)) return;
  q.impactContract = 'v2-definitive-impact-1'; q.impacts = []; q.contactsThroughAt = q.startedAt; q.resolveAt=0;
  q.damageTotals = {}; q.shieldedPlayerIds = room.players.filter(p => p.shield).map(p => p.id);
  if (['cluster','nuke'].includes(q.weaponType)) {
    const parent=contact(q,'designator',rules.cluster,{}, {...q});
    forecast(room,q,parent);
    Object.assign(q,{impactX:parent.x,impactY:parent.y,impactAt:parent.impactAt,
      durationMs:parent.impactAt-q.startedAt,impactReason:parent.contactType,hitPlayerId:parent.targetPlayerId});
  }
  if (q.weaponType === 'triple') {
    q.impacts = q.volley.map((shot, i) => contact(q, `triple-${i}`, rules.triple, {}, shot));
  } else if (q.weaponType === 'cluster') {
    q.impacts.push(contact(q, 'parent', rules.cluster, { x: q.impactX, y: q.impactY, impactAt: q.impactAt,
      contactType: q.impactReason, targetPlayerId: q.hitPlayerId },{
      startX:q.startX,startY:q.startY,vx:q.vx,vy:q.vy,gravity:q.gravity,windAccel:q.windAccel,startedAt:q.startedAt,collisionTimeScale:q.collisionTimeScale,ownerLaunchSpawn:q.ownerLaunchSpawn}));
    // Fixed launch spread and nominal 1333ms return arc, from the FINAL parent.
    // A side hit starts just outside the rock along the incoming normal.
    q.clusterImpacts = ['terrain', 'player'].includes(q.impactReason) ? [-180,-90,0,90,180].map((dx,index)=>clusterLaunch(q,dx,index)) : [];
    q.impacts.push(...q.clusterImpacts.map((shot, i) => contact(q, `cluster-${i}`, rules.child, {}, shot)));
  } else if (q.weaponType === 'airstrike') {
    q.targetX=clamp(q.impactX,40,width-40);
    for(const shell of q.airStrikeShells)shell.x=clamp(q.targetX+(shell.index-3)*105,35,width-35);
    q.impacts = q.airStrikeShells.map((shell, i) => {
      // Keep 4s fall + 233ms stagger. Empty columns exit the arena, not fake rock.
      const hit = firstHuancavelicaV2SolidOnSegment(room, {x:shell.x,y:0}, {x:shell.x,y:height});
      Object.assign(shell, {startX:shell.x,startY:0,vx:0,vy:(hit?.y ?? height + 120)/4,gravity:0,windAccel:0,
        startedAt:shell.visualStartAt,bitmapFlight:true});
      return contact(q, `air-${i}`, rules.airstrike, {}, shell);
    });
  } else {
    q.targetX = clamp(q.impactX,30,width-30); q.targetY = clamp(q.impactY,0,height);
    q.targetLockedAt = q.impactAt; q.warningUntil = q.beamAt = q.impactAt + 5000;
    q.beamUntil = q.beamAt + 5000;
    // Clip along the SAME diagonal, not each endpoint coordinate independently:
    // the designator remains on the beam even near the arena edges.
    const before=Math.min(1,(q.targetX-30)/900,q.targetY/320);
    const after=Math.min(1,(width-30-q.targetX)/900,(height-q.targetY)/320);
    q.nukeBeam = {ax:q.targetX-900*before,ay:q.targetY-320*before,
      bx:q.targetX+900*after,by:q.targetY+320*after,halfWidth:115};
    q.impacts = [contact(q, 'beam', rules.nuke, {x:q.targetX,y:q.targetY,impactAt:q.beamAt,contactType:'beam',beam:{...q.nukeBeam}})];
  }
  refreshV2Weapon(room, q);
}
export function refreshV2Weapon(room, q) {
  const environment=[q.contactsThroughAt,room.players.map(p=>[p.id,p.spawn?.x,p.spawn?.y,p.alive].join(':')).join('|'),
    room.arena.craters.map(c=>[c.id,c.x,c.y,c.radius].join(':')).join('|')].join('/');
  if(q.forecastEnvironment===environment)return;
  q.forecastEnvironment=environment;
  for (const event of q.impacts) {
    forecast(room,q,event);
    if(q.weaponType==='cluster'&&event.id===`${q.id}:parent`&&!event.resolved){
      Object.assign(q,{impactX:event.x,impactY:event.y,impactAt:event.impactAt,durationMs:event.impactAt-q.startedAt,
        impactReason:event.contactType,hitPlayerId:event.targetPlayerId});
      for(const child of q.clusterImpacts){Object.assign(child,clusterLaunch(q,[-180,-90,0,90,180][child.index],child.index));}
      if(!['terrain','player'].includes(event.contactType)){
        q.clusterImpacts=[];q.impacts=q.impacts.filter(e=>e===event);
        break;
      }
    }
  }
  q.specialResolveAt = Math.max(...q.impacts.map(event => event.impactAt));
  q.resolveAt = Math.max(q.resolveAt ?? 0, q.weaponType === 'nuke' ? q.beamUntil + 1500 : q.specialResolveAt + 900);
  room.match.turnEndsAt = q.resolveAt;
}
function distanceToBeam(p, beam) {
  const dx=beam.bx-beam.ax,dy=beam.by-beam.ay,len=dx*dx+dy*dy;
  const t=clamp(((p.x-beam.ax)*dx+(p.y-beam.ay)*dy)/Math.max(1,len),0,1);
  return Math.hypot(p.x-beam.ax-t*dx,p.y-beam.ay-t*dy);
}
export function applyV2WeaponImpact(room, q, event) {
  if (event.resolved) return;
  event.resolved = true;
  const rule = event.damageRule;
  if (!['terrain','player','beam'].includes(event.contactType)) { syncPresentation(event); return; }
  for (const p of room.players) {
    if (p.alive === false || !p.spawn) continue;
    const point = {x:p.spawn.x,y:p.spawn.y-10}, distance = event.beam ? distanceToBeam(point,event.beam) : Math.hypot(point.x-event.x,point.y-event.y);
    const raw = rule.kind === 'direct' ? (event.targetPlayerId === p.id ? rule.damage : 0) : distance <= rule.radius ?
      (rule.kind === 'beam' ? rule.damage : Math.max(1,Math.round(rule.damage*(1-distance/rule.radius)))) : 0;
    if (!raw) continue;
    const previous=q.damageTotals[p.id]??0,total=previous+raw,shield=q.shieldedPlayerIds.includes(p.id);
    // Shield covers one COMPLETE attack, with stable cumulative rounding even
    // when server ticks batch several subimpacts together.
    const damage=shield?Math.ceil(total*.5)-Math.ceil(previous*.5):raw;
    q.damageTotals[p.id]=total;
    if(shield)p.shield=null;
    const actual=Math.min(p.hp??100,damage);
    p.hp=Math.max(0,(p.hp??100)-damage);p.alive=p.hp>0;
    if(actual)p.lastDamage={amount:actual,at:event.impactAt,sourcePlayerId:q.ownerPlayerId,attackId:q.id,impactId:event.id};
    if(!p.alive)p.motion=null;
    event.damageResults.push({playerId:p.id,rawDamage:raw,damage:actual,shielded:shield});
  }
  const cut = (x,y,index='0') => {
    const crater={id:`${event.id}:cut-${index}`,attackId:q.id,impactId:event.id,ownerPlayerId:q.ownerPlayerId,
      x,y,radius:rule.cutRadius,depth:rule.depth,createdAt:event.impactAt};
    event.terrainCuts.push(crater);room.arena.craters.push(crater);
  };
  if(event.beam){
    const b=event.beam,length=Math.hypot(b.bx-b.ax,b.by-b.ay),steps=Math.ceil(length/45);
    // Overlapping radius118 scars cover the entire visible half-width115 beam,
    // including underground rock and every separate mass it crosses.
    for(let i=0;i<=steps;i++)cut(b.ax+(b.bx-b.ax)*i/steps,b.ay+(b.by-b.ay)*i/steps,i);
    room.pickups=(room.pickups??[]).filter(box=>distanceToBeam(box,b)>b.halfWidth+45);
    q.nukeApplied=true;
  }else if(rule.cutRadius)cut(event.x,event.y);
  if(event.flight)event.flight.applied=true;
  syncPresentation(event);
}
