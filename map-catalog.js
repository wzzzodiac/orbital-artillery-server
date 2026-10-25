import {randomInt} from 'node:crypto';

// Public match choices. Historical terrain helpers remain internal to the
// collision/recovery code and are never offered as selectable maps.
export const PLAYABLE_TERRAINS=Object.freeze([
 {id:'rolling',name:'Chacras del Chillón'},
 {id:'brokenridge',name:'Cantera de Carabayllo'},
 {id:'huancavelica-v2',name:'Huancavelica Simulator v2'}
].map(Object.freeze));
export const isPlayableTerrain=id=>PLAYABLE_TERRAINS.some(map=>map.id===id);
export function randomPlayableTerrain(current,choose=randomInt){
 const choices=PLAYABLE_TERRAINS.filter(map=>map.id!==current);
 return choices[choose(choices.length)].id;
}
