import {readFileSync} from 'node:fs';
import {createBitmapTerrain} from './simulation/terrain.js';
import {THEMED_BITMAP_MAPS,themedMapFor,isThemedBitmapRoom,themedArenaMetadata} from './simulation/themed-maps.js';
export {THEMED_BITMAP_MAPS,themedMapFor,isThemedBitmapRoom,themedArenaMetadata};
export const themedTerrains=Object.freeze(Object.fromEntries(Object.values(THEMED_BITMAP_MAPS).map(config=>[config.id,createBitmapTerrain(new Uint8Array(readFileSync(new URL('./assets/'+config.folder+'-terrain-mask.bin',import.meta.url))),config.geometry)])));
export function initializeThemedSpawns(room){
 if(!isThemedBitmapRoom(room)||!room.arena)return;
 const config=themedMapFor(room),terrain=themedTerrains[config.id];Object.assign(room.arena,themedArenaMetadata(config));
 for(const [index,player]of room.players.entries()){
  const x=config.spawnXs[index],y=terrain.findHuancavelicaV2SurfaceBelow(room,x,0,5000);
  if(y==null)throw new Error('Missing bitmap spawn '+config.id+'/'+index);
  Object.assign(player,{spawn:{x,y:y-8,facing:index%2?-1:1},motion:null,airborne:null,v2HorizontalInput:0,outOfWorld:false});
 }
}
