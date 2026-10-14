import {v2Terrain} from './huancavelica-v2-bitmap.js';
import {createWeaponRules} from './simulation/weapons.js';
export const {usesV2MultiImpact,weaponPoint,prepareV2Weapon,refreshV2Weapon,applyV2WeaponImpact}=createWeaponRules(v2Terrain);
