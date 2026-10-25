import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBitmapTerrain} from '../simulation/terrain.js';
import {createAirbornePhysics} from '../simulation/airborne.js';
import {PRACTICE_PROFILES} from '../simulation/practice-profiles.js';
import {THEMED_BITMAP_MAPS} from '../simulation/themed-maps.js';
const configs=[...Object.values(THEMED_BITMAP_MAPS),{id:'huancavelica-v2',folder:'huancavelica-v2'}];
const terrainFor=config=>createBitmapTerrain(new Uint8Array(readFileSync(new URL('../assets/'+config.folder+'-terrain-mask.bin',import.meta.url))),config.geometry);
const overlaps=(terrain,room,p)=>[-45,0,45].some(dx=>[-59,-30,-4].some(dy=>terrain.isHuancavelicaV2Solid(room,p.spawn.x+dx,p.spawn.y+dy)));
for(const config of configs)for(const profile of Object.values(PRACTICE_PROFILES))test(config.id+'/'+profile.id+': jump contacts stay movable across slopes, ledges and crater edges',()=>{
 const terrain=terrainFor(config),physics=createAirbornePhysics(terrain,profile.air),room={arena:{craters:[]}};let cases=0;
 for(const damage of [false,true])for(let x=100;x<4900;x+=70){
  room.arena.craters=[];let y=terrain.findHuancavelicaV2SurfaceBelow(room,x,0,5000);if(y==null)continue;
  if(damage){room.arena.craters=[{id:'edge',x:x+65,y:y+15,radius:135}];y=terrain.findHuancavelicaV2SurfaceBelow(room,x,0,5000);if(y==null)continue;}
  const initial={spawn:{x,y:y-8,facing:1},hp:100,alive:true,v2HorizontalInput:0};if(overlaps(terrain,room,initial)||physics.v2GroundSurface(room,initial.spawn)==null)continue;
  for(const dir of [-1,1])for(const release of [300,900]){
   const p=structuredClone(initial);physics.setV2AirInput(p,dir);physics.startV2Airborne(p,0,{jump:true});let stationary=0,previous={...p.spawn};
   for(let now=20;now<=7000&&p.alive&&p.airborne;now+=20){
    if(now>=release)physics.setV2AirInput(p,0);physics.advanceV2AirbornePlayer(room,p,now);
    stationary=Math.hypot(p.spawn.x-previous.x,p.spawn.y-previous.y)<.001?stationary+20:0;previous={...p.spawn};
    assert.ok(stationary<600,config.id+' stationary in air at '+x);
   }
   if(p.alive&&!p.airborne){
    assert.equal(overlaps(terrain,room,p),false,'landing must leave the collision body outside rock at '+x);
    const left=structuredClone(p),right=structuredClone(p);
    assert.ok(physics.walkV2Player(room,left,-1,8000).moved||physics.walkV2Player(room,right,1,8000).moved,'at least one direction remains available '+JSON.stringify({x,dir,release,damage,p}));
   }
   cases++;
  }
 }
 assert.ok(cases>=60,'real authored mask coverage');
});
test('old shallow wedged poses recover locally without resetting HP or teleporting to another platform',()=>{
 const cases=JSON.parse(readFileSync(new URL('./fixtures/edge-wedges.json',import.meta.url),'utf8'));
 assert.equal(cases.length,13);
 for(const fixture of cases){
  const config=configs.find(c=>c.id===fixture.map),terrain=terrainFor(config),physics=createAirbornePhysics(terrain,PRACTICE_PROFILES[fixture.profile].air),room={arena:{craters:fixture.craters}},p=structuredClone(fixture.final),before={...p.spawn};
  assert.ok(overlaps(terrain,room,p));assert.equal(physics.advanceV2AirbornePlayer(room,p,8000),true,JSON.stringify(fixture));
  assert.ok(Math.hypot(p.spawn.x-before.x,p.spawn.y-before.y)<=12);assert.equal(p.hp,100);assert.ok(p.alive);
  assert.equal(overlaps(terrain,room,p),false);
  const dummy={...structuredClone(fixture.final),dummy:true,dynamicBody:true,hp:0,alive:false};
  assert.equal(physics.advanceV2AirbornePlayer(room,dummy,8000),true);assert.equal(overlaps(terrain,room,dummy),false);assert.equal(dummy.hp,0);assert.equal(dummy.alive,false);
  assert.ok(physics.walkV2Player(room,structuredClone(p),-1,8020).moved||physics.walkV2Player(room,structuredClone(p),1,8020).moved,JSON.stringify({fixture,p}));
 }
});
