import test from 'node:test';
import assert from 'node:assert/strict';
import {V2_AIR_PHYSICS,advanceV2AirbornePlayer} from '../huancavelica-v2-airborne.js';
import {findHuancavelicaV2SurfaceBelow,huancavelicaV2ImageToWorld} from '../huancavelica-v2-bitmap.js';
test('G06 recovered free-air cannot remain airborne and stationary at an island edge',()=>{
  const world={arena:{craters:[]}};
  for(let px=10;px<1438;px+=3){
    const x=huancavelicaV2ImageToWorld(px+.5,0).x,top=findHuancavelicaV2SurfaceBelow(world,x);if(top==null)continue;
    const p={id:'p',spawn:{x,y:top-38,facing:1},alive:true,hp:100,airborne:{vx:0,vy:300,input:0,startedAt:1000,updatedAt:1000}};
    let stationary=0,lastY=p.spawn.y;
    for(let i=1;i<=80&&p.airborne;i++){
      advanceV2AirbornePlayer(world,p,1000+i*20);stationary=Math.abs(p.spawn.y-lastY)<1e-5?stationary+1:0;lastY=p.spawn.y;
      assert.ok(stationary<25,`edge imageX=${px}: airborne with no progress`);
      if(p.spawn.y>top+150)break;
    }
  }
});
test('G12 jump apex reaches the authored main-to-upper-left rise without editing terrain',()=>{
  const rise=(379-247)*5000/1448;
  assert.ok(V2_AIR_PHYSICS.jumpImpulse**2/(2*V2_AIR_PHYSICS.gravity)>rise+30);
});
