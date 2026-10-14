import {readFileSync} from 'node:fs';
import {createBitmapTerrain} from './simulation/terrain.js';
export * from './simulation/terrain.js';
const terrain=createBitmapTerrain(new Uint8Array(readFileSync(new URL('./assets/huancavelica-v2-terrain-mask.bin',import.meta.url))));
export const {huancavelicaV2ImageToWorld,worldToHuancavelicaV2Image,clearHuancavelicaV2Crater,huancavelicaV2MaskForRoom,isHuancavelicaV2Solid,isPlayableHuancavelicaV2Boundary,huancavelicaV2SurfaceCandidatesBelow,findHuancavelicaV2SurfaceBelow,findHuancavelicaV2SurfaceNear,huancavelicaV2LandingHasRun,firstHuancavelicaV2SolidOnSegment,firstHuancavelicaV2ProjectileImpact,huancavelicaV2JumpPathClear,huancavelicaV2BitmapTestHooks}=terrain;
export {terrain as v2Terrain};
