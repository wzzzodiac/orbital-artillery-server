import {
  HUANCAVELICA_V2_WORLD_HEIGHT,
  HUANCAVELICA_V2_WORLD_WIDTH,
  findHuancavelicaV2SurfaceNear,
  huancavelicaV2LandingHasRun,
  isHuancavelicaV2Solid
} from './huancavelica-v2-bitmap.js';

// World units / seconds. The server is the only authority for these values.
export const V2_AIR_PHYSICS = Object.freeze({
  jumpImpulse: 650,
  gravity: 1050,
  airAcceleration: 1500,
  maxHorizontalSpeed: 320,
  airDrag: 1.35,
  terminalSpeed: 1100,
  bodyHalfWidth: 11,
  bodyTop: -11,
  bodyFeet: 8,
  sweepDistance: 2,
  maxStepSeconds: 1 / 120,
  voidBoundary: HUANCAVELICA_V2_WORLD_HEIGHT + 80
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const solid = (room, x, y) => isHuancavelicaV2Solid(room, x, y);
const sideBlocked = (room, x, y, direction) => {
  const edge = x + direction * V2_AIR_PHYSICS.bodyHalfWidth;
  return [-9, -2, 6].some(offset => solid(room, edge, y + offset));
};
const headBlocked = (room, x, y) => [-9, 0, 9].some(offset => solid(room, x + offset, y + V2_AIR_PHYSICS.bodyTop));
const feetBlocked = (room, x, y) => [-9, 0, 9].some(offset => solid(room, x + offset, y + V2_AIR_PHYSICS.bodyFeet));
const bodyClear = (room, x, y) => ![-9, -2, 6].some(offset => [-9, 0, 9].some(dx => solid(room, x + dx, y + offset)));

export function v2GroundSurface(room, spawn) {
  if (!spawn || !bodyClear(room, spawn.x, spawn.y)) return null;
  const feet = spawn.y + V2_AIR_PHYSICS.bodyFeet;
  const surface = findHuancavelicaV2SurfaceNear(room, spawn.x, feet, 7, 9);
  return surface != null && Math.abs(surface - feet) <= 7 && huancavelicaV2LandingHasRun(room, spawn.x, surface, 9, 12) ? surface : null;
}

export function startV2Airborne(player, now, { jump = false, reason = 'ledge' } = {}) {
  if (player.airborne) return false;
  const input = clamp(Number(player.v2HorizontalInput) || 0, -1, 1);
  player.airborne = {
    vx: jump ? input * 80 : input * 55,
    vy: jump ? -V2_AIR_PHYSICS.jumpImpulse : 0,
    input,
    startedAt: now,
    updatedAt: now,
    reason
  };
  player.motion = null;
  return true;
}

export function setV2AirInput(player, direction) {
  if (![-1, 0, 1].includes(direction)) return false;
  player.v2HorizontalInput = direction;
  if (player.airborne) player.airborne.input = direction;
  return true;
}

function sweepHorizontal(room, player, delta) {
  if (!delta) return false;
  const direction = Math.sign(delta), steps = Math.ceil(Math.abs(delta) / V2_AIR_PHYSICS.sweepDistance);
  for (let index = 0; index < steps; index += 1) {
    const x = clamp(player.spawn.x + delta / steps, V2_AIR_PHYSICS.bodyHalfWidth, HUANCAVELICA_V2_WORLD_WIDTH - V2_AIR_PHYSICS.bodyHalfWidth);
    if (x === player.spawn.x) continue;
    if (sideBlocked(room, x, player.spawn.y, direction)) return true;
    player.spawn.x = x;
  }
  player.spawn.facing = direction;
  return false;
}

function landingSurface(room, spawn, previousFeet) {
  const feet = spawn.y + V2_AIR_PHYSICS.bodyFeet;
  const surface = findHuancavelicaV2SurfaceNear(room, spawn.x, feet, 7, 7);
  if (surface == null || surface < previousFeet - 2 || surface > feet + 4) return null;
  if (!huancavelicaV2LandingHasRun(room, spawn.x, surface, 9, 12)) return null;
  const settled = { ...spawn, y: surface - V2_AIR_PHYSICS.bodyFeet };
  return bodyClear(room, settled.x, settled.y) ? settled : null;
}

function sweepVertical(room, player, delta) {
  if (!delta) return false;
  const descending = delta > 0, steps = Math.ceil(Math.abs(delta) / V2_AIR_PHYSICS.sweepDistance);
  for (let index = 0; index < steps; index += 1) {
    const previousFeet = player.spawn.y + V2_AIR_PHYSICS.bodyFeet;
    const y = player.spawn.y + delta / steps;
    if (descending && feetBlocked(room, player.spawn.x, y)) {
      const settled = landingSurface(room, { ...player.spawn, y }, previousFeet);
      if (settled) { player.spawn = settled; return 'landed'; }
      return 'blocked';
    }
    if (!descending && headBlocked(room, player.spawn.x, y)) return 'blocked';
    player.spawn.y = y;
  }
  return false;
}

export function advanceV2AirbornePlayer(room, player, now) {
  const air = player.airborne;
  if (!air || !player.spawn || player.alive === false) return false;
  // Bounded elapsed time avoids a huge teleport after process suspension. Every
  // simulated move is spatially swept, so even a late tick cannot tunnel.
  let remaining = clamp((now - air.updatedAt) / 1000, 0, .25);
  if (!remaining) return false;
  while (remaining > 1e-7 && player.airborne) {
    const dt = Math.min(remaining, V2_AIR_PHYSICS.maxStepSeconds);
    remaining -= dt;
    air.vx = clamp((air.vx + air.input * V2_AIR_PHYSICS.airAcceleration * dt) * Math.exp(-V2_AIR_PHYSICS.airDrag * dt), -V2_AIR_PHYSICS.maxHorizontalSpeed, V2_AIR_PHYSICS.maxHorizontalSpeed);
    air.vy = Math.min(V2_AIR_PHYSICS.terminalSpeed, air.vy + V2_AIR_PHYSICS.gravity * dt);
    // Rising clears the ground before horizontal steering is tested; on descent
    // we test the side first so the body cannot cut diagonally through a wall.
    const rising = air.vy < 0;
    let hit = rising ? sweepVertical(room, player, air.vy * dt) : false;
    if (sweepHorizontal(room, player, air.vx * dt)) air.vx = 0;
    if (!rising) hit = sweepVertical(room, player, air.vy * dt);
    if (hit === 'landed') { player.airborne = null; player.v2HorizontalInput = 0; break; }
    if (hit === 'blocked') air.vy = 0;
    if (player.spawn.y + V2_AIR_PHYSICS.bodyTop > V2_AIR_PHYSICS.voidBoundary) {
      player.airborne = null;
      player.v2HorizontalInput = 0;
      player.alive = false;
      player.hp = 0;
      break;
    }
  }
  if (player.airborne) air.updatedAt = now;
  return true;
}
