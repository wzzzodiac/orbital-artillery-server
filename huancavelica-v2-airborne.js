import {v2Terrain} from './huancavelica-v2-bitmap.js';
import {createAirbornePhysics} from './simulation/airborne.js';
export {V2_AIR_PHYSICS} from './simulation/airborne.js';
export const {v2GroundSurface,startV2Airborne,setV2AirInput,walkV2Player,advanceV2AirbornePlayer}=createAirbornePhysics(v2Terrain);
