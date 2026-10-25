import {V09_BALLISTIC_BALANCE,COMBAT_MOTION_RULES as motion} from './rules.js';
import {HUANCAVELICA_V2_WORLD_HEIGHT as height,HUANCAVELICA_V2_WORLD_WIDTH as width} from './terrain.js?v=bitmap-maps-1';
// Policy owns match rotation/results/telemetry; gameplay resolution is identical.
export function createCombatResolver({terrain,physics,weapons,policy}){
const width=terrain.geometry?.worldWidth??5000,height=terrain.geometry?.worldHeight??3750;
 const {findHuancavelicaV2SurfaceBelow,firstHuancavelicaV2SolidOnSegment}=terrain;
 const {startV2Airborne,v2GroundSurface}=physics;
 const {usesV2MultiImpact,prepareV2Weapon,refreshV2Weapon,applyV2WeaponImpact}=weapons;
 const {beginTurn,finishMatch,resultFor,snapshotCombatState,recordCombatEvents}=policy;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const voidY = height + 120;
const usesV2CombatResolver = q => Boolean(q && (['basic', 'heavy'].includes(q.weaponType ?? 'basic') || usesV2MultiImpact(q)));

function fallTo(room,player,surface,now){
  if((player.dummy&&!player.dynamicBody)||(player.alive===false&&!player.dynamicBody)||player.outOfWorld||player.airborne||v2GroundSurface(room,player.spawn)!=null)return 0;
  startV2Airborne(player,now,{reason:'support_loss'});return now+50;
}
function knockback(room,player,q,distance,now){
  if((player.dummy&&!player.dynamicBody)||q.hitPlayerId===player.id)return 0;
  const strength=clamp(1-distance/motion.radius,0,1);if(strength<motion.minStrength)return 0;
  let dx=player.spawn.x-q.impactX,dy=player.spawn.y-10-q.impactY,length=Math.hypot(dx,dy);
  if(length<1){dx=player.spawn.facing||1;dy=-.25;length=Math.hypot(dx,dy);}
  const speed=150+(motion.maxSpeed-150)*strength;
  startV2Airborne(player,now,{reason:'knockback'});
  player.airborne.vx=dx/length*speed;player.airborne.vy=dy/length*speed-motion.liftBias*strength;
  player.airborne.input=0;player.spawn.facing=player.airborne.vx<0?-1:1;return now+50;
}

function resolveImpact(room, q, now) {
  q.resolutionApplied = true;
  if (!['terrain', 'player'].includes(q.impactReason)) return;
  const rule = V09_BALLISTIC_BALANCE[q.weaponType ?? 'basic'];
  const affected = [];
  // 1. Contact is already definitive from fireOnV2/adjustProjectile.
  // 2. Apply final balanced damage and Shield exactly once, before any death.
  for (const player of room.players) {
    if (player.alive === false || !player.spawn) continue;
    const distance = Math.hypot(player.spawn.x - q.impactX, player.spawn.y - 10 - q.impactY);
    if (distance > rule.radius) continue;
    let damage = q.hitPlayerId === player.id ? rule.damage : clamp(Math.round(rule.damage * (1 - distance / rule.radius)), 1, rule.damage);
    if (player.shield) { damage = Math.max(1, Math.ceil(damage * V09_BALLISTIC_BALANCE.shieldFactor)); player.shield = null; }
    player.hp = Math.max(0, (player.hp ?? 100) - damage);
    player.alive = player.hp > 0;
    player.lastDamage = { amount: damage, at: now, sourcePlayerId: q.ownerPlayerId };
    if (!player.alive) player.motion = null;
    affected.push({ player, distance });
  }
  // 3. A single cut at the final contact, available to every support query.
  room.arena.craters.push({ id: q.weaponType === 'heavy' ? `${q.id}-heavy` : q.id,
    // Preserve depth metadata for legacy adapters; v2 collision uses x/y/radius.
    x: q.impactX, y: Math.round(q.impactY), radius: rule.craterRadius, depth: rule.craterDepth, createdAt: q.impactAt });
  let latestEnd = 0;
  const knocked = new Set();
  for (const { player, distance } of affected) if (player.alive) {
    const endsAt = knockback(room, player, q, distance, now);
    if (endsAt) { knocked.add(player.id); latestEnd = Math.max(latestEnd, endsAt); }
  }
  // 4/5. Settle support and void survival against that same mutated bitmap.
  for (const player of room.players) {
    if (player.alive === false || !player.spawn || knocked.has(player.id)) continue;
    const surface = findHuancavelicaV2SurfaceBelow(room, player.spawn.x, Math.max(0, player.spawn.y + motion.groundOffset - 3), height);
    latestEnd = Math.max(latestEnd, fallTo(room, player, surface, now));
  }
  if (latestEnd) q.resolveAt = Math.max(q.resolveAt, latestEnd + motion.finishBufferMs);
  room.match.turnEndsAt = q.resolveAt;
}

// Sole owner of v2 combat resolution. No legacy damage/support pass and
// no restoration after results or telemetry have observed a temporary death.
function advanceV2Combat(room, now) {
  if (room.status !== 'started') return null;
  const q = room.match?.projectile;
  if (!usesV2CombatResolver(q)) return null;
  let changed = false;
  if (usesV2MultiImpact(q)) {
    refreshV2Weapon(room,q);
    // Resolve chronological contacts, refreshing survivors against each new
    // bitmap. A slow/batched tick produces the same sequence as small ticks.
    for (;;) {
      const event = q.impacts.filter(e => !e.resolved).sort((a,b) => a.impactAt-b.impactAt || a.id.localeCompare(b.id))[0];
      if (!event || event.impactAt > now) break;
      const before = snapshotCombatState(room);
      applyV2WeaponImpact(room,q,event);
      let latestEnd=0;
      for (const p of room.players) if(p.alive!==false&&p.spawn) {
        const surface=findHuancavelicaV2SurfaceBelow(room,p.spawn.x,Math.max(0,p.spawn.y+motion.groundOffset-3),height);
        latestEnd=Math.max(latestEnd,fallTo(room,p,surface,event.impactAt));
      }
      if(latestEnd)q.resolveAt=Math.max(q.resolveAt,latestEnd+motion.finishBufferMs);
      recordCombatEvents(room,before,{sourceId:q.ownerPlayerId,weaponType:q.weaponType,attackId:q.id,impactId:event.id});
      q.contactsThroughAt=event.impactAt;
      refreshV2Weapon(room,q);
      room.match.pendingResult=resultFor(room);
      changed=true;
    }
  } else if (!q.resolutionApplied && now >= q.impactAt) {
    const before = snapshotCombatState(room);
    resolveImpact(room, q, now);
    // 6/7. Publish only definitive survival/damage; finalization waits for motion.
    room.match.pendingResult = resultFor(room);
    recordCombatEvents(room, before, { sourceId: q.ownerPlayerId, weaponType: q.weaponType ?? 'basic' });
    changed = true;
  }
  if (now < q.resolveAt) return changed ? room : null;
  if(room.players.some(p=>p.alive!==false&&p.airborne)){q.resolveAt=now+50;room.match.turnEndsAt=q.resolveAt;return room;}
  const result = resultFor(room); // Never trust a stale cached candidate.
  room.match.pendingResult = null;
  room.match.shotResolvedAt = now;
  return result ? finishMatch(room, result, now) : beginTurn(room, room.match.turnIndex + 1, now);
}

return Object.freeze({usesV2CombatResolver,prepareV2Weapon,advanceV2Combat});
}
