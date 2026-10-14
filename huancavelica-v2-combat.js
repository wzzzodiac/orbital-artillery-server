import { beginTurn, finishMatch, resultFor, COMBAT_MOTION_RULES as motion } from './rooms.js';
import { V09_BALLISTIC_BALANCE } from './phase6d-v09.js';
import { snapshotCombatState, recordCombatEvents } from './phase7a1.js';
import { usesV2MultiImpact, prepareV2Weapon, refreshV2Weapon, applyV2WeaponImpact } from './huancavelica-v2-weapons.js';
export { prepareV2Weapon };
import {
  HUANCAVELICA_V2_WORLD_WIDTH as width, HUANCAVELICA_V2_WORLD_HEIGHT as height,
  findHuancavelicaV2SurfaceBelow, firstHuancavelicaV2SolidOnSegment
} from './huancavelica-v2-bitmap.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const voidY = height + 120;
export const usesV2CombatResolver = q => Boolean(q && (['basic', 'heavy'].includes(q.weaponType ?? 'basic') || usesV2MultiImpact(q)));

function fallTo(room, player, surface, now) {
  const from = { ...player.spawn }, voided = surface == null;
  const targetY = voided ? voidY : Math.round(surface - motion.groundOffset);
  if (!voided && targetY <= from.y + 2) return 0;
  const endsAt = now + (voided ? motion.fallMs : Math.min(motion.fallMs, 900));
  player.spawn = { ...from, y: targetY };
  player.motion = { type: 'fall', startedAt: now, endsAt, fromX: from.x, fromY: from.y, toX: from.x, toY: targetY, apex: 0, bitmapSupportLost: true };
  if (voided) { player.hp = 0; player.alive = false; }
  return endsAt;
}

// Same combat knockback coefficients as the existing game, but contact and
// landing query the v2 bitmap, never the islands heightfield. This is not the
// separate free-air movement/jump rework.
function knockback(room, player, q, distance, now) {
  if (q.hitPlayerId === player.id) return 0;
  const strength = clamp(1 - distance / motion.radius, 0, 1);
  if (strength < motion.minStrength) return 0;
  const from = { ...player.spawn };
  let dx = from.x - q.impactX, dy = from.y - 10 - q.impactY;
  let length = Math.hypot(dx, dy);
  if (length < 1) { dx = from.facing || 1; dy = -.25; length = Math.hypot(dx, dy); }
  const speed = 150 + (motion.maxSpeed - 150) * strength;
  const vx = dx / length * speed, vy = dy / length * speed - motion.liftBias * strength;
  let previous = from, target = from, seconds = .25;
  for (let t = motion.dt; t <= motion.maxSeconds; t += motion.dt) {
    const point = { x: clamp(from.x + vx * t, 20, width - 20), y: from.y + vy * t + .5 * motion.gravity * t * t };
    seconds = t;
    const descending = vy + motion.gravity * t >= 0;
    const hit = t > .08 ? firstHuancavelicaV2SolidOnSegment(room,
      { x: previous.x, y: previous.y + motion.groundOffset },
      { x: point.x, y: point.y + motion.groundOffset }) : null;
    if (hit) {
      const surface = descending ? findHuancavelicaV2SurfaceBelow(room, hit.x, Math.max(0, hit.y - 7), 14) : null;
      target = surface == null ? previous : { x: hit.x, y: surface - motion.groundOffset };
      break;
    }
    target = point; previous = point;
    if (point.y >= voidY) break;
  }
  const surface = findHuancavelicaV2SurfaceBelow(room, target.x, Math.max(0, target.y + motion.groundOffset - 3), height);
  const voided = surface == null;
  target = { x: Math.round(target.x), y: voided ? voidY : Math.round(surface - motion.groundOffset) };
  const endsAt = now + Math.max(260, Math.round(seconds * 1000));
  player.spawn = { ...target, facing: vx < -1 ? -1 : vx > 1 ? 1 : from.facing || 1 };
  player.motion = { type: voided ? 'knockbackVoid' : 'knockback', startedAt: now, endsAt, fromX: from.x, fromY: from.y, toX: target.x, toY: target.y, vx, vy, gravity: motion.gravity, strength };
  if (voided) { player.hp = 0; player.alive = false; }
  return endsAt;
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
export function advanceV2Combat(room, now) {
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
  const result = resultFor(room); // Never trust a stale cached candidate.
  room.match.pendingResult = null;
  room.match.shotResolvedAt = now;
  return result ? finishMatch(room, result, now) : beginTurn(room, room.match.turnIndex + 1, now);
}
