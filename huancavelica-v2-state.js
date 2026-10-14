import {
  HUANCAVELICA_V2_ID, HUANCAVELICA_V2_NAME, HUANCAVELICA_V2_REVISION,
  HUANCAVELICA_V2_COLLISION_MODEL, HUANCAVELICA_V2_WORLD_WIDTH, HUANCAVELICA_V2_WORLD_HEIGHT,
  HUANCAVELICA_V2_IMAGE_WIDTH, HUANCAVELICA_V2_IMAGE_HEIGHT, HUANCAVELICA_V2_SCALE, huancavelicaV2ImageToWorld,
  findHuancavelicaV2SurfaceNear, findHuancavelicaV2SurfaceBelow
} from './huancavelica-v2-bitmap.js';

export const V2_SPAWN_HINTS = Object.freeze([
  {x:281,y:379,label:'left-main'}, {x:1161,y:380,label:'right-main'},
  {x:730,y:449,label:'center-main'}, {x:472,y:247,label:'upper-left'},
  {x:1118,y:250,label:'upper-right'}, {x:420,y:532,label:'middle-left'},
  {x:1020,y:532,label:'middle-right'}, {x:730,y:786,label:'lower-center'}
]);

export function isV2Room(room) {
  return room?.phase11TerrainAlias === HUANCAVELICA_V2_ID || room?.arena?.phase11Theme === HUANCAVELICA_V2_ID;
}

export function v2SpawnAtHint(room, hint, index) {
  const world = huancavelicaV2ImageToWorld(hint.x, hint.y);
  const surface = findHuancavelicaV2SurfaceNear(room, world.x, world.y, 80, 100)
    ?? findHuancavelicaV2SurfaceBelow(room, world.x, Math.max(0, world.y - 100), 220);
  if (surface == null) throw new Error(`Huancavelica v2 spawn hint ${hint.label} has no playable surface`);
  return {x: Math.round(world.x), y: Math.round(surface - 8), facing: index % 2 === 0 ? 1 : -1};
}

// Only match initialization calls this. Participant count and serialization are
// deliberately not lifecycle triggers; rematches receive a fresh arena first.
export function initializeV2Spawns(room) {
  if (!isV2Room(room)) return;
  installV2ArenaMetadata(room);
  room.players.forEach((player, index) => {
    const hint = V2_SPAWN_HINTS[index % V2_SPAWN_HINTS.length];
    player.spawn = v2SpawnAtHint(room, hint, index);
    player.motion = null;
    player.phase11SpawnHint = hint.label;
  });
  room.phase11SpawnKey = room.match.countdownStartedAt;
}

export function installV2ArenaMetadata(room) {
  if (!isV2Room(room) || !room.arena) return;
  Object.assign(room.arena, {
    terrainPreset: HUANCAVELICA_V2_ID, terrainName: HUANCAVELICA_V2_NAME,
    phase11Theme: HUANCAVELICA_V2_ID, terrainRevision: HUANCAVELICA_V2_REVISION,
    collisionModel: HUANCAVELICA_V2_COLLISION_MODEL,
    worldWidth: HUANCAVELICA_V2_WORLD_WIDTH, worldHeight: HUANCAVELICA_V2_WORLD_HEIGHT,
    voidFloor: true, platforms: [], legacyCollisionBase: 'islands',
    bitmapTerrain: { width: HUANCAVELICA_V2_IMAGE_WIDTH, height: HUANCAVELICA_V2_IMAGE_HEIGHT,
      worldWidth: HUANCAVELICA_V2_WORLD_WIDTH, worldHeight: HUANCAVELICA_V2_WORLD_HEIGHT,
      uniformScale: HUANCAVELICA_V2_SCALE, maskSource: 'cleaned-terrain-alpha-guided-by-supplied-mask' }
  });
}
