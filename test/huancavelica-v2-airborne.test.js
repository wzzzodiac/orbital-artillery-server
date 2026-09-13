import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUANCAVELICA_V2_WORLD_HEIGHT,
  findHuancavelicaV2SurfaceBelow,
  huancavelicaV2ImageToWorld,
  isHuancavelicaV2Solid
} from '../huancavelica-v2-bitmap.js';
import {
  V2_AIR_PHYSICS,
  advanceV2AirbornePlayer,
  setV2AirInput,
  startV2Airborne,
  v2GroundSurface
} from '../huancavelica-v2-airborne.js';

const point = (x, y) => huancavelicaV2ImageToWorld(x, y);
const room = (craters = []) => ({ arena: { craters } });
function groundedPlayer(world = room(), imageX = 720, imageStartY = 400) {
  const x = point(imageX, 0).x;
  const surface = findHuancavelicaV2SurfaceBelow(world, x, point(0, imageStartY).y, 350);
  assert.ok(surface != null);
  const player = { spawn: { x, y: surface - 8, facing: 1 }, hp: 100, alive: true, airborne: null };
  assert.ok(v2GroundSurface(world, player.spawn) != null);
  return player;
}
function advance(world, player, start, count, interval = 50) {
  for (let i = 1; i <= count && player.airborne; i += 1) advanceV2AirbornePlayer(world, player, start + i * interval);
}

test('stationary jump has upward velocity, gravity and a natural nearby landing', () => {
  const world = room(), player = groundedPlayer(world), from = { ...player.spawn };
  assert.equal(startV2Airborne(player, 1000, { jump: true }), true);
  assert.equal(player.airborne.vy, -V2_AIR_PHYSICS.jumpImpulse);
  assert.equal(player.motion, null);
  assert.equal(startV2Airborne(player, 1001, { jump: true }), false, 'no double jump');
  advanceV2AirbornePlayer(world, player, 1100);
  assert.ok(player.airborne.vy > -V2_AIR_PHYSICS.jumpImpulse);
  assert.ok(player.spawn.y < from.y);
  advance(world, player, 1100, 35);
  assert.equal(player.airborne, null);
  assert.ok(Math.abs(player.spawn.x - from.x) < 1);
  assert.ok(Math.abs(player.spawn.y - from.y) < 4);
});

test('A/D accelerate and counter-steer with bounded horizontal velocity; release stops acceleration', () => {
  const world = room(), player = groundedPlayer(world), start = 1000;
  setV2AirInput(player, 1);
  startV2Airborne(player, start, { jump: true });
  advance(world, player, start, 8);
  const rightX = player.spawn.x, rightV = player.airborne.vx;
  assert.ok(rightV > 0 && rightV <= V2_AIR_PHYSICS.maxHorizontalSpeed);
  setV2AirInput(player, -1);
  advance(world, player, start + 400, 8);
  assert.ok(player.airborne.vx < rightV && player.spawn.x < rightX + 150);
  setV2AirInput(player, 0);
  const beforeRelease = Math.abs(player.airborne.vx);
  advanceV2AirbornePlayer(world, player, start + 850);
  assert.ok(!player.airborne || Math.abs(player.airborne.vx) <= beforeRelease + 1);
});

test('ascending head hits the underside instead of passing through rock', () => {
  const world = room(), player = { spawn: { ...point(720, 263), facing: 1 }, alive: true };
  assert.equal(isHuancavelicaV2Solid(world, player.spawn.x, player.spawn.y - 11), false);
  startV2Airborne(player, 1000, { jump: true });
  advanceV2AirbornePlayer(world, player, 1050);
  assert.ok(player.airborne.vy >= 0, 'upward velocity is cancelled by the underside');
  assert.equal(isHuancavelicaV2Solid(world, player.spawn.x, player.spawn.y - 11), false);
});

test('side-wall sweep prevents the vehicle body from entering rock', () => {
  const world = room(), player = { spawn: { ...point(570, 125), facing: 1 }, alive: true,
    airborne: { vx: 320, vy: 0, input: 1, updatedAt: 1000 } };
  advance(world, player, 1000, 10);
  for (const dy of [-9, -2, 6]) for (const dx of [-9, 0, 9])
    assert.equal(isHuancavelicaV2Solid(world, player.spawn.x + dx, player.spawn.y + dy), false);
  assert.ok(player.spawn.x < point(620, 0).x, 'the side is not crossed or climbed');
});

test('terminal-speed descent sweeps through thin grass and lands on the first top surface', () => {
  const world = room(), x = point(720, 0).x, top = findHuancavelicaV2SurfaceBelow(world, x, 0, 1000);
  const player = { spawn: { x, y: top - 180, facing: 1 }, alive: true,
    airborne: { vx: 0, vy: V2_AIR_PHYSICS.terminalSpeed, input: 0, updatedAt: 1000 } };
  advanceV2AirbornePlayer(world, player, 1250);
  assert.equal(player.airborne, null);
  assert.ok(Math.abs(player.spawn.y + 8 - top) < 4);
});

test('destroyed support falls by gravity and can land on a lower island', () => {
  const top = findHuancavelicaV2SurfaceBelow(room(), point(720, 0).x, 0, 1000);
  const world = room([{ id: 'opening', ...point(720, 170), radius: 350 }]);
  const player = { spawn: { x: point(720, 0).x, y: top - 8, facing: 1 }, alive: true, hp: 100 };
  assert.equal(v2GroundSurface(world, player.spawn), null);
  startV2Airborne(player, 1000, { reason: 'support_loss' });
  const originalY = player.spawn.y;
  assert.equal(player.airborne.vy, 0);
  assert.equal(player.spawn.y, originalY, 'no lower-platform teleport');
  advance(world, player, 1000, 50);
  assert.equal(player.airborne, null);
  assert.ok(player.spawn.y > originalY + 500);
  assert.ok(v2GroundSurface(world, player.spawn) != null);
});

test('void death is delayed until the body actually crosses the world boundary', () => {
  const world = room(), player = { spawn: { ...point(10, 900), facing: 1 }, hp: 100, alive: true };
  startV2Airborne(player, 1000, { reason: 'ledge' });
  assert.equal(player.alive, true);
  advanceV2AirbornePlayer(world, player, 1050);
  assert.equal(player.alive, true);
  advance(world, player, 1050, 50);
  assert.equal(player.alive, false);
  assert.ok(player.spawn.y - 11 > HUANCAVELICA_V2_WORLD_HEIGHT + 80);
});

test('mask authority ignores decor and hanging vines', () => {
  const world = room();
  assert.equal(isHuancavelicaV2Solid(world, point(640, 268).x, point(640, 268).y), false);
  assert.equal(isHuancavelicaV2Solid(world, point(841, 568).x, point(841, 568).y), false);
});
