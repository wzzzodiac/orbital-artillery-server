import test from 'node:test';
import assert from 'node:assert/strict';
import { phase10HuancavelicaTestHooks } from '../phase10-huancavelica.js';

const { HUANCAVELICA_PLATFORMS, installHuancavelicaArena } = phase10HuancavelicaTestHooks;
const byId=new Map(HUANCAVELICA_PLATFORMS.map(p=>[p.id,p]));
const routeFits=(from,to)=>{
  const horizontalGap=Math.max(0,to.x1-from.x2,from.x1-to.x2);
  return horizontalGap<=420&&Math.abs(to.y-from.y)<=1050;
};

test('Huancavelica Simulator exposes one connected multilayer platform graph',()=>{
  assert.ok(HUANCAVELICA_PLATFORMS.length>=24);
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
  assert.equal(room.arena.collisionModel,'multilayer-platforms-v1');
  assert.equal(room.arena.voidFloor,true);
  assert.equal(room.arena.platforms.length,HUANCAVELICA_PLATFORMS.length);
  for(const player of room.players){
    assert.ok(player.phase10PlatformId);
    assert.ok(Number.isFinite(player.spawn.x));
    assert.ok(Number.isFinite(player.spawn.y));
    assert.ok(player.spawn.y<5000);
  }
});
