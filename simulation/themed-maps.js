const geometry=Object.freeze({imageWidth:1672,imageHeight:1672,worldWidth:5000,worldHeight:5000});
export const THEMED_BITMAP_MAPS=Object.freeze({
 rolling:Object.freeze({id:'rolling',name:'Chacras del Chillón',folder:'chacras',revision:'chacras-bitmap-1',geometry,spawnXs:[900,4100,1950,3050,450,4550,1450,3500],practiceXs:[800,1000],pickupXs:[450,900,1450,1950,2500,3050,3550,4100,4550]}),
 brokenridge:Object.freeze({id:'brokenridge',name:'Cantera de Carabayllo',folder:'cantera',revision:'cantera-bitmap-1',geometry,spawnXs:[650,4400,1450,2900,2100,3500,180,4800],practiceXs:[550,780],pickupXs:[180,650,1450,2050,2900,3500,4400,4800]})
});
export const themedMapFor=room=>THEMED_BITMAP_MAPS[room?.terrainPreset??room?.arena?.terrainPreset]??null;
export const isThemedBitmapRoom=room=>Boolean(themedMapFor(room)&&(room?.bitmapMapsEnabled||room?.arena?.bitmapTheme===themedMapFor(room).id));
export function themedArenaMetadata(config){return {terrainPreset:config.id,terrainName:config.name,bitmapTheme:config.id,terrainRevision:config.revision,collisionModel:'bitmap-terrain-mask-v2',worldWidth:5000,worldHeight:5000,previewSpawns:[],platforms:[],voidFloor:true,bitmapTerrain:{width:1672,height:1672,worldWidth:5000,worldHeight:5000,uniformScale:5000/1672,maskSource:'approved-art-aligned-binary-mask'}};}
