import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,setPlayerReady,startRoom,activateRoom,roomStore} from '../rooms.js';
import {setTerrain9,fireProjectile9,setAim9,publicRoomState9} from '../phase11-huancavelica-v2.js';
import {firstHuancavelicaV2SolidOnSegment,isHuancavelicaV2Solid} from '../huancavelica-v2-bitmap.js';
import {createAimFlight,projectileMuzzle,traceFlight,VEHICLE_HITBOX} from '../simulation/collision.js';

function fixture(run) {
  const old=Date.now;let now=1800000000000;Date.now=()=>now;roomStore.clear();
  try {
    const room=createRoom('a','A').room;joinRoom(room.code,'b','B');setTerrain9('a','huancavelica-v2');
    setPlayerReady('a',true);setPlayerReady('b',true);startRoom('a');now=room.match.startAt;activateRoom(room.code,now);
    room.match.activePlayerId='b';room.match.wind={signed:0};run(room,room.players[1],room.players[0]);
  } finally {Date.now=old;roomStore.clear();}
}
test('G04 final composed Basic grazes the 51-unit vehicle, not its owner or legacy ground',()=>fixture((room,shooter,target)=>{
  shooter.spawn={x:500,y:1000,facing:1};
  const v=815/Math.sqrt(2),t=.5,dy=-v+480*t,len=Math.hypot(v,dy);
  target.spawn={x:524+v*t-dy/len*40,y:976-v*t+240*t*t+v/len*40+10,facing:-1};
  setAim9('b',45,55);assert.equal(fireProjectile9('b').ok,true);
  const q=room.match.projectile;
  assert.equal(q.impactReason,'player');assert.equal(q.hitPlayerId,'a');
  assert.ok(Math.abs(Math.hypot(q.impactX-target.spawn.x,q.impactY-(target.spawn.y-10))-51)<.01,'swept first circle entry, not a sampled point inside');
}));

for(const weapon of ['basic','heavy','triple','cluster','nuke','airstrike'])for(const [angle,power,wind] of [[20,55,-14],[45,55,0],[70,100,17]])for(const precut of [false,true]){
  test(`G04 final composed ${weapon} ${angle}/${power} wind${wind} precut${precut}: shared preview first contact`,()=>fixture((room,shooter)=>{
    room.match.wind={signed:wind};
    if(precut)room.arena.craters.push({id:'precut',x:3825,y:1139,radius:150,depth:100});
    const angles=weapon==='triple'?[angle-6,angle,angle+6]:[angle];
    const predicted=angles.map(a=>{
      const shot=projectileMuzzle(createAimFlight(shooter,a,power,wind),(x,y)=>isHuancavelicaV2Solid(room,x,y));
      return traceFlight(shot,{players:room.players,ownerId:shooter.id,firstSolid:(a,b)=>firstHuancavelicaV2SolidOnSegment(room,a,b)});
    });
    shooter.inventory=[{type:weapon},null];shooter.selectedItemSlot=weapon==='basic'?1:2;
    setAim9(shooter.id,angle,power);assert.equal(fireProjectile9(shooter.id).ok,true);const q=room.match.projectile;
    const actual=weapon==='triple'?q.volley:[q];
    for(let i=0;i<actual.length;i++){
      assert.equal(actual[i].impactReason,predicted[i].type);assert.equal(actual[i].hitPlayerId,predicted[i].targetPlayerId);
      assert.ok(Math.hypot(actual[i].impactX-predicted[i].x,actual[i].impactY-predicted[i].y)<.001,'pacing cannot change spatial collision');
    }
    if(weapon==='airstrike')assert.equal(q.targetX,Math.max(40,Math.min(4960,predicted[0].x)));
  }));
}
test('G04 contract radius and swept underside/side obey nearest terrain contact',()=>{
  assert.equal(VEHICLE_HITBOX.radius,51);
  for(const [from,to] of [[{x:1800,y:1570},{x:2300,y:1570}],[{x:2485,y:2500},{x:2485,y:1500}]]){
    const room={arena:{craters:[]}},hit=firstHuancavelicaV2SolidOnSegment(room,from,to);assert.ok(hit);
    const shot={startX:from.x,startY:from.y,vx:to.x-from.x,vy:to.y-from.y,gravity:0};
    const actual=traceFlight(shot,{firstSolid:(a,b)=>firstHuancavelicaV2SolidOnSegment(room,a,b)});
    assert.equal(actual.type,'terrain');assert.ok(isHuancavelicaV2Solid(room,actual.x,actual.y));
    assert.ok(Math.hypot(actual.x-hit.x,actual.y-hit.y)<4);
  }
});
test('G04 final composed vehicle behind solid rock cannot win contact ordering',()=>fixture((room,shooter,target)=>{
  shooter.spawn={x:1700,y:1450,facing:1};target.spawn={x:2100,y:1570,facing:-1};
  setAim9('b',0,100);assert.equal(fireProjectile9('b').ok,true);const q=room.match.projectile;
  assert.equal(q.impactReason,'terrain');assert.equal(q.hitPlayerId,null);
  assert.ok(isHuancavelicaV2Solid(room,q.impactX,q.impactY));
  const hit=firstHuancavelicaV2SolidOnSegment(room,{x:q.startX,y:q.startY},{x:q.impactX,y:q.impactY});
  assert.ok(hit);assert.ok(Math.hypot(hit.x-q.impactX,hit.y-q.impactY)<4);
  const before=structuredClone(room);publicRoomState9(room);assert.deepEqual(room,before);
}));
