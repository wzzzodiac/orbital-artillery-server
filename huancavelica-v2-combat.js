import {beginTurn,finishMatch,resultFor} from './rooms.js';
import {snapshotCombatState,recordCombatEvents} from './phase7a1.js';
import {v2Terrain} from './huancavelica-v2-bitmap.js';
import * as physics from './huancavelica-v2-airborne.js';
import * as weapons from './huancavelica-v2-weapons.js';
import {createCombatResolver} from './simulation/combat.js';
export const {usesV2CombatResolver,prepareV2Weapon,advanceV2Combat}=createCombatResolver({terrain:v2Terrain,physics,weapons,policy:{beginTurn,finishMatch,resultFor,snapshotCombatState,recordCombatEvents}});
