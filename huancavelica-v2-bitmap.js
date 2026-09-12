import { readFileSync } from 'node:fs';

export const HUANCAVELICA_V2_ID='huancavelica-v2';
export const HUANCAVELICA_V2_NAME='Huancavelica Simulator v2';
export const HUANCAVELICA_V2_REVISION='huancavelica-v2-bitmap-1';
export const HUANCAVELICA_V2_COLLISION_MODEL='bitmap-terrain-mask-v2';
export const HUANCAVELICA_V2_IMAGE_WIDTH=1448;
export const HUANCAVELICA_V2_IMAGE_HEIGHT=1086;
export const HUANCAVELICA_V2_WORLD_WIDTH=5000;
export const HUANCAVELICA_V2_SCALE=HUANCAVELICA_V2_WORLD_WIDTH/HUANCAVELICA_V2_IMAGE_WIDTH;
export const HUANCAVELICA_V2_WORLD_HEIGHT=HUANCAVELICA_V2_IMAGE_HEIGHT*HUANCAVELICA_V2_SCALE;

const PIXEL_COUNT=HUANCAVELICA_V2_IMAGE_WIDTH*HUANCAVELICA_V2_IMAGE_HEIGHT;
const EXPECTED_BYTES=Math.ceil(PIXEL_COUNT/8);
const CLEAN_MASK=new Uint8Array(readFileSync(new URL('./assets/huancavelica-v2-terrain-mask.bin',import.meta.url)));
if(CLEAN_MASK.length!==EXPECTED_BYTES)throw new Error(`Invalid Huancavelica v2 mask: expected ${EXPECTED_BYTES} bytes, received ${CLEAN_MASK.length}`);

const roomMasks=new WeakMap();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const bitIndex=(px,py)=>py*HUANCAVELICA_V2_IMAGE_WIDTH+px;
const hasBit=(mask,index)=>Boolean(mask[index>>3]&(1<<(index&7)));
const clearBit=(mask,index)=>{mask[index>>3]&=~(1<<(index&7));};

export function huancavelicaV2ImageToWorld(x,y){return{x:Number(x)*HUANCAVELICA_V2_SCALE,y:Number(y)*HUANCAVELICA_V2_SCALE};}
export function worldToHuancavelicaV2Image(x,y){return{x:Number(x)/HUANCAVELICA_V2_SCALE,y:Number(y)/HUANCAVELICA_V2_SCALE};}

function craterSignature(craters){return(craters??[]).map(c=>[c.id??'',Number(c.x),Number(c.y),Number(c.radius)].join(':')).join('|');}

export function clearHuancavelicaV2Crater(mask,crater){
  const x=Number(crater?.x),y=Number(crater?.y),radius=Math.max(0,Number(crater?.radius));
  if(![x,y,radius].every(Number.isFinite)||radius<=0)return mask;
  const center=worldToHuancavelicaV2Image(x,y),pixelRadius=radius/HUANCAVELICA_V2_SCALE;
  const minX=clamp(Math.floor(center.x-pixelRadius),0,HUANCAVELICA_V2_IMAGE_WIDTH-1),maxX=clamp(Math.ceil(center.x+pixelRadius),0,HUANCAVELICA_V2_IMAGE_WIDTH-1);
  const minY=clamp(Math.floor(center.y-pixelRadius),0,HUANCAVELICA_V2_IMAGE_HEIGHT-1),maxY=clamp(Math.ceil(center.y+pixelRadius),0,HUANCAVELICA_V2_IMAGE_HEIGHT-1);
  for(let py=minY;py<=maxY;py+=1){const dy=py+.5-center.y;for(let px=minX;px<=maxX;px+=1){const dx=px+.5-center.x;if(dx*dx+dy*dy<=pixelRadius*pixelRadius)clearBit(mask,bitIndex(px,py));}}
  return mask;
}

export function huancavelicaV2MaskForRoom(room){
  const craters=room?.arena?.craters??[],signature=craterSignature(craters),cached=room&&roomMasks.get(room);
  if(cached?.signature===signature)return cached.mask;
  const mask=CLEAN_MASK.slice();
  for(const crater of craters)clearHuancavelicaV2Crater(mask,crater);
  if(room)roomMasks.set(room,{signature,mask});
  return mask;
}

export function isHuancavelicaV2Solid(room,x,y){
  const image=worldToHuancavelicaV2Image(x,y),px=Math.floor(image.x),py=Math.floor(image.y);
  if(px<0||px>=HUANCAVELICA_V2_IMAGE_WIDTH||py<0||py>=HUANCAVELICA_V2_IMAGE_HEIGHT)return false;
  return hasBit(huancavelicaV2MaskForRoom(room),bitIndex(px,py));
}

function boundaryAt(mask,px,py){return py>=0&&py<HUANCAVELICA_V2_IMAGE_HEIGHT&&hasBit(mask,bitIndex(px,py))&&(py===0||!hasBit(mask,bitIndex(px,py-1)));}
function boundaryNearPixel(mask,px,targetPy,radius=12){
  if(px<0||px>=HUANCAVELICA_V2_IMAGE_WIDTH)return null;
  for(let delta=0;delta<=radius;delta+=1){for(const py of delta?[Math.floor(targetPy-delta),Math.ceil(targetPy+delta)]:[Math.round(targetPy)])if(boundaryAt(mask,px,py))return py;}
  return null;
}

export function isPlayableHuancavelicaV2Boundary(mask,px,py){
  if(!boundaryAt(mask,px,py))return false;
  const probes=[-6,-3,3,6].map(dx=>boundaryNearPixel(mask,px+dx,py,12));
  const left=probes.slice(0,2).some(value=>value!=null&&Math.abs(value-py)<=12);
  const right=probes.slice(2).some(value=>value!=null&&Math.abs(value-py)<=12);
  return left&&right;
}

export function huancavelicaV2SurfaceCandidatesBelow(room,x,startY=0,maxDistance=HUANCAVELICA_V2_WORLD_HEIGHT){
  const image=worldToHuancavelicaV2Image(x,startY),px=Math.floor(image.x);
  if(px<0||px>=HUANCAVELICA_V2_IMAGE_WIDTH)return[];
  const mask=huancavelicaV2MaskForRoom(room),startPy=clamp(Math.floor(image.y),0,HUANCAVELICA_V2_IMAGE_HEIGHT-1),endPy=clamp(Math.ceil((Number(startY)+Number(maxDistance))/HUANCAVELICA_V2_SCALE),0,HUANCAVELICA_V2_IMAGE_HEIGHT-1),result=[];
  for(let py=startPy;py<=endPy;py+=1)if(isPlayableHuancavelicaV2Boundary(mask,px,py))result.push(huancavelicaV2ImageToWorld(px+.5,py).y);
  return result;
}

export function findHuancavelicaV2SurfaceBelow(room,x,startY=0,maxDistance=HUANCAVELICA_V2_WORLD_HEIGHT){return huancavelicaV2SurfaceCandidatesBelow(room,x,startY,maxDistance)[0]??null;}

export function findHuancavelicaV2SurfaceNear(room,x,targetY,up=42,down=42){
  const values=huancavelicaV2SurfaceCandidatesBelow(room,x,Math.max(0,Number(targetY)-up),up+down);
  return values.sort((a,b)=>Math.abs(a-targetY)-Math.abs(b-targetY))[0]??null;
}

export function huancavelicaV2LandingHasRun(room,x,y,run=28,tolerance=75){
  for(const offset of[-run,-run*.5,run*.5,run]){const nearby=findHuancavelicaV2SurfaceNear(room,x+offset,y,tolerance,tolerance);if(nearby==null||Math.abs(nearby-y)>tolerance)return false;}
  return true;
}

export function firstHuancavelicaV2SolidOnSegment(room,from,to,minimumT=0){
  const a=worldToHuancavelicaV2Image(from.x,from.y),b=worldToHuancavelicaV2Image(to.x,to.y),steps=Math.max(1,Math.ceil(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))*1.25));
  for(let index=Math.max(0,Math.floor(minimumT*steps));index<=steps;index+=1){const t=index/steps,x=Number(from.x)+(Number(to.x)-Number(from.x))*t,y=Number(from.y)+(Number(to.y)-Number(from.y))*t;if(isHuancavelicaV2Solid(room,x,y))return{x,y,t};}
  return null;
}

export function firstHuancavelicaV2ProjectileImpact(room,projectile,maxSeconds=8){
  if(!projectile||![projectile.startX,projectile.startY].every(value=>Number.isFinite(Number(value))))return null;
  const pointAt=t=>({x:Number(projectile.startX)+Number(projectile.vx??0)*t+.5*Number(projectile.windAccel??0)*t*t,y:Number(projectile.startY)+Number(projectile.vy??0)*t+.5*Number(projectile.gravity??480)*t*t});
  let previousT=.08,previous=pointAt(previousT);
  for(let t=.10;t<=maxSeconds+.0001;t+=.02){const point=pointAt(t);if(point.x<0||point.x>HUANCAVELICA_V2_WORLD_WIDTH||point.y>HUANCAVELICA_V2_WORLD_HEIGHT+150)return null;const hit=firstHuancavelicaV2SolidOnSegment(room,previous,point);if(hit){const impactT=previousT+(t-previousT)*hit.t,impact=pointAt(impactT);return{...impact,t:impactT};}previousT=t;previous=point;}
  return null;
}

export function huancavelicaV2JumpPathClear(room,from,to,apex){
  let previous={x:from.x,y:from.y-18};
  for(let index=1;index<=96;index+=1){const t=index/96,x=from.x+(to.x-from.x)*t,baseY=from.y+(to.y-from.y)*t,y=baseY-Math.sin(Math.PI*t)*apex-18,current={x,y};if(t<.94&&firstHuancavelicaV2SolidOnSegment(room,previous,current))return false;previous=current;}
  return true;
}

export const huancavelicaV2BitmapTestHooks=Object.freeze({CLEAN_MASK,bitIndex,hasBit,craterSignature,boundaryAt,boundaryNearPixel});
