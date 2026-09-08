import test from 'node:test';
import assert from 'node:assert/strict';
import { phase10HuancavelicaTestHooks } from '../phase10-huancavelica.js';
import {
  huancavelicaNearestSurface,
  huancavelicaSurfaceBelow,
  huancavelicaSurfacesAtX,
  isHuancavelicaSolid
} from '../huancavelica-bitmap.js';

const {
  adjustProjectileToPlatforms,
  arcIsClear,
  findJumpLanding,
  findWalkTarget
} = phase10HuancavelicaTestHooks;

const cleanRoom = () => ({ arena: { craters: [] } });

function findWalkFixture(room) {
  for (let x = 120; x <= 4860; x += 15) {
    for (const surface of huancavelicaSurfacesAtX(room, x)) {
      const next = huancavelicaNearestSurface(room, x + 15, surface, { maxRise: 42, maxDrop: 42 });
      if (next != null) return { x, surface, next };
    }
  }
  return null;
}

function findJumpFixture(room) {
  for (let x = 120; x <= 4880; x += 40) {
    for (const surface of huancavelicaSurfacesAtX(room, x)) {
      const from = { x, y: Math.round(surface - 8), facing: 1 };
      for (const dir of [1, -1]) {
        const landing = findJumpLanding(room, from, dir);
        if (landing) return { from, dir, landing };
      }
    }
  }
  return null;
}

test('authored bitmap exposes stacked top surfaces instead of one legacy heightfield', () => {
  const room = cleanRoom();
  let multiColumn = null;
  for (let x = 100; x <= 4900; x += 25) {
    const surfaces = huancavelicaSurfacesAtX(room, x);
    if (surfaces.length >= 2) { multiColumn = { x, surfaces }; break; }
  }
  assert.ok(multiColumn, 'expected at least one x column containing vertically stacked authored terrain');
  assert.ok(multiColumn.surfaces[1] > multiColumn.surfaces[0]);
});

test('walking follows the authored mask at 15 world-unit steps', () => {
  const room = cleanRoom(), fixture = findWalkFixture(room);
  assert.ok(fixture, 'expected a continuous authored walking surface');
  const target = findWalkTarget(room, { x: fixture.x, y: fixture.surface - 8 }, 1);
  assert.equal(target.type, 'walk');
  assert.equal(target.x, fixture.x + 15);
  assert.ok(Math.abs((target.y + 8) - fixture.next) <= 1);
  assert.equal(isHuancavelicaSolid(room, target.x, target.y + 12), true, 'terrain must exist immediately below the grounded player');
});

test('walking off an authored edge falls to the next bitmap surface or into the void', () => {
  const room = cleanRoom();
  let fixture = null;
  for (let x = 120; x <= 4860 && !fixture; x += 15) {
    for (const surface of huancavelicaSurfacesAtX(room, x)) {
      const nextX = x + 15;
      if (huancavelicaNearestSurface(room, nextX, surface, { maxRise: 42, maxDrop: 42 }) != null) continue;
      const target = findWalkTarget(room, { x, y: surface - 8 }, 1);
      if (target.type === 'fall' || target.type === 'void') fixture = { surface, target };
    }
  }
  assert.ok(fixture, 'expected at least one authored ledge');
  if (fixture.target.type === 'fall') assert.ok(fixture.target.surfaceY > fixture.surface + 42);
});

test('jump landing is selected from bitmap surfaces and the full arc stays clear', () => {
  const room = cleanRoom(), fixture = findJumpFixture(room);
  assert.ok(fixture, 'expected at least one valid bitmap-native jump');
  const { from, landing } = fixture;
  assert.ok(landing.distance >= 60 && landing.distance <= 420);
  assert.ok(landing.apex >= 150 && landing.apex <= 1050);
  assert.equal(arcIsClear(room, from, landing.x, landing.y, landing.apex), true);
  const support = huancavelicaNearestSurface(room, landing.x, landing.y + 8, { maxRise: 2, maxDrop: 2 });
  assert.ok(support != null, 'jump endpoint must sit on authored mask terrain');
});

test('surface-below query respects vertical layering after a ledge', () => {
  const room = cleanRoom();
  let found = null;
  for (let x = 100; x <= 4900; x += 25) {
    const surfaces = huancavelicaSurfacesAtX(room, x);
    if (surfaces.length >= 2) { found = { x, surfaces }; break; }
  }
  assert.ok(found);
  const below = huancavelicaSurfaceBelow(room, found.x, found.surfaces[0] + 5, 5000);
  assert.ok(below != null);
  assert.ok(Math.abs(below - found.surfaces[1]) < 10, 'query must select the next lower authored surface, not the topmost island');
});

test('bitmap terrain collision corrects impact without changing aim or ballistic coefficients', () => {
  const room = cleanRoom();
  const q = {
    id: 'aim-invariant', weaponType: 'basic', ownerPlayerId: 'p1', startedAt: 1000,
    startX: 2500, startY: 100, vx: 0, vy: 0, gravity: 480, windAccel: 0,
    angle: 45, power: 55, impactReason: 'timeout', impactX: 2500, impactY: 5000,
    durationMs: 8000, impactAt: 9000, resolveAt: 9900
  };
  const before = { angle:q.angle, power:q.power, vx:q.vx, vy:q.vy, gravity:q.gravity, windAccel:q.windAccel };
  assert.equal(adjustProjectileToPlatforms(room, q), true);
  assert.deepEqual({ angle:q.angle, power:q.power, vx:q.vx, vy:q.vy, gravity:q.gravity, windAccel:q.windAccel }, before);
  assert.equal(q.impactReason, 'terrain');
  assert.ok(q.impactY < 1000);
});
