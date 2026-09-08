import { readFileSync } from 'node:fs';

export const HUANCAVELICA_IMAGE_WIDTH = 1448;
export const HUANCAVELICA_IMAGE_HEIGHT = 1086;
export const HUANCAVELICA_WORLD_WIDTH = 5000;
export const HUANCAVELICA_WORLD_HEIGHT = 5000;
export const HUANCAVELICA_ALPHA_THRESHOLD = 16;

const PIXEL_COUNT = HUANCAVELICA_IMAGE_WIDTH * HUANCAVELICA_IMAGE_HEIGHT;
const CLEAN_MASK = new Uint8Array(readFileSync(new URL('./assets/huancavelica-terrain-mask.bin', import.meta.url)));
const EXPECTED_BYTES = Math.ceil(PIXEL_COUNT / 8);
if (CLEAN_MASK.length !== EXPECTED_BYTES) throw new Error(`Invalid Huancavelica mask: expected ${EXPECTED_BYTES} bytes, received ${CLEAN_MASK.length}`);

const roomMasks = new WeakMap();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bitIndex = (px, py) => py * HUANCAVELICA_IMAGE_WIDTH + px;
const hasBit = (mask, index) => Boolean(mask[index >> 3] & (1 << (index & 7)));
const clearBit = (mask, index) => { mask[index >> 3] &= ~(1 << (index & 7)); };
const imageColumn = x => clamp(Math.floor(worldToHuancavelicaImage(x, 0).x), 0, HUANCAVELICA_IMAGE_WIDTH - 1);

export function worldToHuancavelicaImage(x, y) {
  return {
    x: Number(x) / HUANCAVELICA_WORLD_WIDTH * HUANCAVELICA_IMAGE_WIDTH,
    y: Number(y) / HUANCAVELICA_WORLD_HEIGHT * HUANCAVELICA_IMAGE_HEIGHT
  };
}

export function huancavelicaImageToWorld(x, y) {
  return {
    x: Number(x) / HUANCAVELICA_IMAGE_WIDTH * HUANCAVELICA_WORLD_WIDTH,
    y: Number(y) / HUANCAVELICA_IMAGE_HEIGHT * HUANCAVELICA_WORLD_HEIGHT
  };
}

function craterSignature(craters) {
  return (craters ?? []).map(crater => [crater.id ?? '', Number(crater.x), Number(crater.y), Number(crater.radius)].join(':')).join('|');
}

export function clearHuancavelicaCrater(mask, crater) {
  const x = Number(crater?.x), y = Number(crater?.y), radius = Math.max(0, Number(crater?.radius));
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return mask;
  const center = worldToHuancavelicaImage(x, y);
  const radiusX = radius / HUANCAVELICA_WORLD_WIDTH * HUANCAVELICA_IMAGE_WIDTH;
  const radiusY = radius / HUANCAVELICA_WORLD_HEIGHT * HUANCAVELICA_IMAGE_HEIGHT;
  const minX = clamp(Math.floor(center.x - radiusX), 0, HUANCAVELICA_IMAGE_WIDTH - 1);
  const maxX = clamp(Math.ceil(center.x + radiusX), 0, HUANCAVELICA_IMAGE_WIDTH - 1);
  const minY = clamp(Math.floor(center.y - radiusY), 0, HUANCAVELICA_IMAGE_HEIGHT - 1);
  const maxY = clamp(Math.ceil(center.y + radiusY), 0, HUANCAVELICA_IMAGE_HEIGHT - 1);
  for (let py = minY; py <= maxY; py += 1) {
    const dy = (py + .5 - center.y) / Math.max(radiusY, .001);
    for (let px = minX; px <= maxX; px += 1) {
      const dx = (px + .5 - center.x) / Math.max(radiusX, .001);
      if (dx * dx + dy * dy <= 1) clearBit(mask, bitIndex(px, py));
    }
  }
  return mask;
}

export function huancavelicaMaskForRoom(room) {
  const craters = room?.arena?.craters ?? [];
  const signature = craterSignature(craters);
  const cached = room && roomMasks.get(room);
  if (cached?.signature === signature) return cached.mask;
  const mask = CLEAN_MASK.slice();
  for (const crater of craters) clearHuancavelicaCrater(mask, crater);
  if (room) roomMasks.set(room, { signature, mask });
  return mask;
}

export function isHuancavelicaSolid(room, x, y) {
  const image = worldToHuancavelicaImage(x, y);
  const px = Math.floor(image.x), py = Math.floor(image.y);
  if (px < 0 || px >= HUANCAVELICA_IMAGE_WIDTH || py < 0 || py >= HUANCAVELICA_IMAGE_HEIGHT) return false;
  return hasBit(huancavelicaMaskForRoom(room), bitIndex(px, py));
}

// Return every top-facing solid transition in one authored bitmap column.
// Unlike a heightfield this preserves stacked islands, caves and side towers.
export function huancavelicaSurfacesAtX(room, x) {
  const px = imageColumn(x), mask = huancavelicaMaskForRoom(room), out = [];
  let previousSolid = false;
  for (let py = 0; py < HUANCAVELICA_IMAGE_HEIGHT; py += 1) {
    const solid = hasBit(mask, bitIndex(px, py));
    if (solid && !previousSolid) out.push(huancavelicaImageToWorld(px + .5, py).y);
    previousSolid = solid;
  }
  return out;
}

export function huancavelicaNearestSurface(room, x, targetY, { maxRise = Infinity, maxDrop = Infinity } = {}) {
  const y = Number(targetY);
  if (!Number.isFinite(y)) return null;
  let best = null, bestDistance = Infinity;
  for (const surface of huancavelicaSurfacesAtX(room, x)) {
    const delta = surface - y;
    if (delta < -Math.max(0, Number(maxRise)) || delta > Math.max(0, Number(maxDrop))) continue;
    const distance = Math.abs(delta);
    if (distance < bestDistance) { best = surface; bestDistance = distance; }
  }
  return best;
}

export function huancavelicaSurfaceBelow(room, x, startY, maxDrop = HUANCAVELICA_WORLD_HEIGHT) {
  const y = Number(startY), limit = Math.max(0, Number(maxDrop));
  if (!Number.isFinite(y)) return null;
  for (const surface of huancavelicaSurfacesAtX(room, x)) {
    if (surface >= y - 0.5 && surface - y <= limit) return surface;
  }
  return null;
}

export function huancavelicaSurfaceNear(room, x, targetY, radius = 420) {
  return huancavelicaNearestSurface(room, x, targetY, { maxRise: radius, maxDrop: radius });
}

export function huancavelicaTopSurface(room, x) {
  return huancavelicaSurfacesAtX(room, x)[0] ?? HUANCAVELICA_WORLD_HEIGHT;
}

export function firstHuancavelicaMaskImpact(room, projectile, maxSeconds = 8) {
  if (!projectile || !Number.isFinite(Number(projectile.startX)) || !Number.isFinite(Number(projectile.startY))) return null;
  const pointAt = t => ({
    x: Number(projectile.startX) + Number(projectile.vx ?? 0) * t + .5 * Number(projectile.windAccel ?? 0) * t * t,
    y: Number(projectile.startY) + Number(projectile.vy ?? 0) * t + .5 * Number(projectile.gravity ?? 480) * t * t
  });
  let previousT = .06;
  for (let t = .066; t <= maxSeconds; t += .006) {
    const point = pointAt(t);
    if (point.x < 0 || point.x > HUANCAVELICA_WORLD_WIDTH || point.y > HUANCAVELICA_WORLD_HEIGHT + 150) return null;
    if (isHuancavelicaSolid(room, point.x, point.y)) {
      let low = previousT, high = t;
      for (let index = 0; index < 7; index += 1) {
        const middle = (low + high) / 2;
        const sample = pointAt(middle);
        if (isHuancavelicaSolid(room, sample.x, sample.y)) high = middle; else low = middle;
      }
      const impact = pointAt(high);
      return { ...impact, t: high };
    }
    previousT = t;
  }
  return null;
}

export const huancavelicaBitmapTestHooks = Object.freeze({
  CLEAN_MASK,
  bitIndex,
  hasBit,
  craterSignature
});
