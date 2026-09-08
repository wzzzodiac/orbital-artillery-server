import test from 'node:test';
import assert from 'node:assert/strict';
import { phase10HuancavelicaTestHooks } from '../phase10-huancavelica.js';
import {
  HUANCAVELICA_IMAGE_HEIGHT,
  HUANCAVELICA_IMAGE_WIDTH,
  clearHuancavelicaCrater,
  huancavelicaBitmapTestHooks,
  huancavelicaImageToWorld,
  huancavelicaMaskForRoom,
  isHuancavelicaSolid,
  worldToHuancavelicaImage
} from '../huancavelica-bitmap.js';

const { HUANCAVELICA_PLATFORMS, bindCraterToPlatform, decoratePublicState, firstPlatformImpact, installHuancavelicaArena, platformSurface } = phase10HuancavelicaTestHooks;
const byId=new Map(HUANCAVELICA_PLATFORMS.map(p=>[p.id,p]));
const routeFits=(from,to)=>{
  const horizontalGap=Math.max(0,to.x1-from.x2,from.x1-to.x2);
  return horizontalGap<=420&&Math.abs(to.y-from.y)<=1050;
};
const mirrorPair=(leftId,rightId)=>{
  const left=byId.get(leftId),right=byId.get(rightId);
  assert.ok(left&&right,`missing mirror pair ${leftId}/${rightId}`);
  assert.equal(left.x1,5000-right.x2,`${leftId}/${rightId} x1 mirror mismatch`);
  assert.equal(left.x2,5000-right.x1,`${leftId}/${rightId} x2 mirror mismatch`);
  assert.equal(left.y,right.y,`${leftId}/${rightId} y mirror mismatch`);
};

test('Huancavelica Simulator exposes one connected multilayer platform graph',()=>{
  assert.equal(HUANCAVELICA_PLATFORMS.length,31);
  const ids=new Set(HUANCAVELICA_PLATFORMS.map(p=>p.id));
  assert.equal(ids.size,HUANCAVELICA_PLATFORMS.length);
  for(const platform of HUANCAVELICA_PLATFORMS){
    assert.ok(platform.x1<platform.x2);
    assert.ok(platform.y>0&&platform.y<5000);
    for(const link of platform.links)assert.ok(ids.has(link),`missing platform link ${platform.id} -> ${link}`);
  }
  const seen=new Set(),queue=[HUANCAVELICA_PLATFORMS[0].id];
  while(queue.length){const id=queue.shift();if(seen.has(id))continue;seen.add(id);const p=byId.get(id);queue.push(...p.links);}
  assert.equal(seen.size,HUANCAVELICA_PLATFORMS.length);
});

test('all Huancavelica platforms remain connected through routes inside the 420/1050 traversal envelope',()=>{
  const seen=new Set(),queue=[HUANCAVELICA_PLATFORMS[0].id];
  while(queue.length){
    const id=queue.shift();if(seen.has(id))continue;seen.add(id);
    const platform=byId.get(id);
    for(const linkId of platform.links){const target=byId.get(linkId);if(routeFits(platform,target))queue.push(linkId);}
  }
  assert.equal(seen.size,HUANCAVELICA_PLATFORMS.length,`unreachable platforms: ${HUANCAVELICA_PLATFORMS.filter(p=>!seen.has(p.id)).map(p=>p.id).join(', ')}`);
});

test('Alpine Ridge v5 preserves the traced concept landmarks and mirrored side towers',()=>{
  mirrorPair('left-shoulder-high','right-shoulder-high');
  mirrorPair('left-cliff-top','right-cliff-top');
  mirrorPair('left-upper-ledge','right-upper-ledge');
  mirrorPair('left-cliff-mid','right-cliff-mid');
  mirrorPair('left-transition','right-transition');
  mirrorPair('left-lower-ledge','right-lower-ledge');
  mirrorPair('left-bottom-ledge','right-bottom-ledge');
  mirrorPair('left-bottom-exit','right-bottom-exit');
  mirrorPair('upper-left','upper-right');
  mirrorPair('high-step-left','high-step-right');
  mirrorPair('mid-left-high','mid-right-high');
  mirrorPair('mid-left-low','mid-right-low');
  mirrorPair('low-step-left','low-step-right');
  mirrorPair('bottom-step-left','bottom-step-right');

  assert.deepEqual([byId.get('top-center').x1,byId.get('top-center').x2,byId.get('top-center').y],[2180,2980,675]);
  assert.deepEqual([byId.get('center-upper').x1,byId.get('center-upper').x2,byId.get('center-upper').y],[2160,2960,2000]);
  assert.deepEqual([byId.get('center-mid').x1,byId.get('center-mid').x2,byId.get('center-mid').y],[2110,2960,3450]);
  assert.deepEqual([byId.get('left-bottom-exit').x1,byId.get('left-bottom-exit').x2,byId.get('left-bottom-exit').y],[780,1410,4890]);

  assert.ok(byId.get('left-shoulder-high').x2<byId.get('high-step-left').x1,'left crown route must cross visible air');
  assert.ok(byId.get('high-step-right').x2<byId.get('right-shoulder-high').x1,'right crown route must cross visible air');
  assert.ok(byId.get('top-center').y<byId.get('upper-left').y&&byId.get('upper-left').y<byId.get('high-step-left').y,'upper crown must descend in concept order');
  assert.ok(byId.get('center-upper').y<byId.get('mid-left-high').y&&byId.get('mid-left-high').y<byId.get('center-mid').y,'middle ladder must preserve the concept vertical rhythm');
  assert.ok(byId.get('bottom-step-left').y>byId.get('low-step-left').y,'bottom stepping stones must sit below the support stones');
});

test('Huancavelica arena installs server-authoritative floating platforms and valid spawn supports',()=>{
  const room={
    phase10TerrainAlias:'huancavelica',
    status:'countdown',
    players:[
      {id:'a',name:'A',alive:true,hp:100,spawn:null,motion:null},
      {id:'b',name:'B',alive:true,hp:100,spawn:null,motion:null}
    ],
    pickups:[],
    arena:{terrainPreset:'islands',terrainName:'Drift Islands',craters:[],worldWidth:5000,worldHeight:5000}
  };
  installHuancavelicaArena(room);
  assert.equal(room.arena.phase10Theme,'huancavelica');
  assert.equal(room.arena.terrainName,'Huancavelica Simulator');
  assert.equal(room.arena.collisionModel,'bitmap-alpha-mask-v1');
  assert.deepEqual(room.arena.bitmapTerrain,{width:1448,height:1086,worldWidth:5000,worldHeight:5000,alphaThreshold:16,maskSource:'terrain-alpha'});
  assert.equal(room.arena.voidFloor,true);
  assert.equal(room.arena.platforms.length,HUANCAVELICA_PLATFORMS.length);
  for(const player of room.players){
    assert.ok(player.phase10PlatformId);
    assert.ok(Number.isFinite(player.spawn.x));
    assert.ok(Number.isFinite(player.spawn.y));
    assert.ok(player.spawn.y<5000);
  }
});

test('Huancavelica is available in the public map pool as a production map',()=>{
  const state=decoratePublicState({}, {terrainPresets:[]});
  assert.deepEqual(state.terrainPresets,[{id:'huancavelica',name:'Huancavelica Simulator'}]);
});

test('bitmap crater removes the visible crown without touching a lower island',()=>{
  const clean={arena:{worldHeight:5000,craters:[]}},top=byId.get('top-center'),middle=byId.get('center-upper');
  const cleanTop=platformSurface(clean,top,2500),cleanMiddle=platformSurface(clean,middle,2500);
  const room={arena:{worldHeight:5000,craters:[{id:'top-hit',x:2500,y:cleanTop,radius:180,depth:165,phase10PlatformId:'top-center'}]}};
  assert.ok(platformSurface(room,top,2500)>cleanTop+150);
  assert.equal(platformSurface(room,middle,2500),cleanMiddle,'a crown crater must not cut the authored island below it');
});

test('legacy crater records are bound to one authoritative platform before publication',()=>{
  const crater={id:'legacy-impact',x:2500,radius:135,depth:165};
  const room={arena:{worldHeight:5000,craters:[crater]}};
  bindCraterToPlatform(room,crater,[{x:2500,y:2000,platformId:'center-upper'}]);
  assert.equal(crater.phase10PlatformId,'center-upper');
  assert.equal(crater.y,2000);
});

test('projectile sampling collides with the visible upper crown before lower stacked islands',()=>{
  const room={arena:{worldHeight:5000,craters:[]}};
  const projectile={startX:2500,startY:100,vx:0,vy:0,windAccel:0,gravity:480};
  const impact=firstPlatformImpact(room,projectile);
  assert.ok(impact);
  assert.equal(impact.platformId,'top-center');
  assert.ok(impact.y>200&&impact.y<280);
  assert.equal(isHuancavelicaSolid(room,impact.x,impact.y+8),true);
});

test('bitmap asset transform is deterministic and invertible',()=>{
  assert.deepEqual([HUANCAVELICA_IMAGE_WIDTH,HUANCAVELICA_IMAGE_HEIGHT],[1448,1086]);
  const image=worldToHuancavelicaImage(1875,3125),world=huancavelicaImageToWorld(image.x,image.y);
  assert.ok(Math.abs(world.x-1875)<1e-9);
  assert.ok(Math.abs(world.y-3125)<1e-9);
});

test('terrain alpha mask has authored solid pixels and transparent void',()=>{
  const room={arena:{craters:[]}};
  assert.equal(isHuancavelicaSolid(room,2500,100),false);
  assert.equal(isHuancavelicaSolid(room,2500,250),true);
  assert.equal(isHuancavelicaSolid(room,2500,1200),false);
});

test('crater clearing mutates collision pixels using the same world circle',()=>{
  const room={arena:{craters:[]}},mask=huancavelicaMaskForRoom(room).slice();
  const center={x:2500,y:300,radius:150};
  assert.equal(isHuancavelicaSolid(room,center.x,center.y),true);
  clearHuancavelicaCrater(mask,center);
  const image=worldToHuancavelicaImage(center.x,center.y),index=Math.floor(image.y)*HUANCAVELICA_IMAGE_WIDTH+Math.floor(image.x);
  assert.equal(huancavelicaBitmapTestHooks.hasBit(mask,index),false);
});

test('authoritative crater events replay identically for repeat queries and late joins',()=>{
  const craters=[{id:'one',x:2500,y:300,radius:150},{id:'two',x:1750,y:1850,radius:110}];
  const room={arena:{craters}},first=huancavelicaMaskForRoom(room),second=huancavelicaMaskForRoom(room);
  assert.equal(first,second,'unchanged rooms should reuse the cached compact mask');
  const reconnect={arena:{craters:craters.map(crater=>({...crater}))}},replayed=huancavelicaMaskForRoom(reconnect);
  assert.notEqual(first,replayed);
  assert.deepEqual(first,replayed,'late join replay must reproduce the authoritative terrain state');
});

test('non-Huancavelica public state keeps its existing collision model',()=>{
  const state=decoratePublicState({}, {terrainPresets:[],arena:{collisionModel:'heightfield'}});
  assert.equal(state.arena.collisionModel,'heightfield');
});
