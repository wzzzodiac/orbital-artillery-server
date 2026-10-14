import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, setGameMode, setPlayerReady, startRoom, activateRoom, roomStore } from '../rooms.js';
import { setTerrain9, publicRoomState9, fireProjectile9, advanceTurnIfDue9, rematchRoom9, setAim9 } from '../phase11-huancavelica-v2.js';
import { isHuancavelicaV2Solid, huancavelicaV2MaskForRoom, findHuancavelicaV2SurfaceBelow, HUANCAVELICA_V2_SCALE as scale } from '../huancavelica-v2-bitmap.js';

let now = 1_800_000_000_000;
function fixture(weapon, run, { map='huancavelica-v2', mode='team', setup=()=>{} }={}) {
  const original = Date.now; Date.now = () => now; roomStore.clear(); now += 100_000;
  try {
    const room = createRoom('a', 'A').room; joinRoom(room.code, 'b', 'B');
    setGameMode('a',mode); setTerrain9('a', map); setPlayerReady('a', true); setPlayerReady('b', true); startRoom('a');
    now = room.match.startAt; activateRoom(room.code, now); publicRoomState9(room);
    room.match.activePlayerId = 'b'; room.match.turnIndex = room.match.turnOrder.indexOf('b');
    room.match.wind = { signed: 0, strength: 0, direction: 'none' };
    const shooter = room.players[1]; shooter.inventory = [{type:weapon,label:weapon},null]; shooter.selectedItemSlot = 2;
    setup(room);
    assert.equal(fireProjectile9('b').ok, true);
    run(room, room.match.projectile);
  } finally { Date.now = original; roomStore.clear(); }
}
function advance(room, time) { now = time; return advanceTurnIfDue9(room.code, now); }
function complete(room,step=50) {
  for(let i=0;i<1000&&room.match.projectile;i++)advance(room,now+step);
  assert.equal(room.match.projectile,null,'bounded completion');
  return publicRoomState9(room);
}
function validateCuts(room,q) {
  const ids=new Set();
  for(const e of q.impacts){
    assert.ok(e.resolved);assert.ok(!ids.has(e.id));ids.add(e.id);
    assert.equal(e.attackId,q.id);assert.equal(e.ownerPlayerId,q.ownerPlayerId);
    for(const c of e.terrainCuts){
      assert.equal(c.impactId,e.id);assert.equal(c.attackId,q.id);
      assert.ok(room.arena.craters.some(actual=>actual.id===c.id&&actual.x===c.x&&actual.y===c.y));
      if(!e.beam){assert.equal(c.x,e.x);assert.equal(c.y,e.y);}
      assert.equal(isHuancavelicaV2Solid(room,c.x,c.y),false);
    }
  }
  assert.equal(new Set(room.arena.craters.map(c=>c.id)).size,room.arena.craters.length);
}

test('CSW-04 composed: child geometry originates at the corrected bitmap parent, not legacy X=1714', () => fixture('cluster', (room, q) => {
  assert.ok(Math.abs(q.impactX - 3824.774) < 4, 'audited contact within one bitmap pixel after shared physical-step correction');
  assert.ok(isHuancavelicaV2Solid(room, q.impactX, q.impactY));
  assert.equal(q.clusterImpacts.length, 5);
  assert.ok(q.clusterImpacts.every(child => Math.abs(child.x - q.impactX) < 700), 'children must not stay 2110 units away');
}));

test('CSW-05 composed: final Nuke target in solid rock is actually removed', () => fixture('nuke', (room, q) => {
  const {impactX:x, impactY:y} = q;
  assert.ok(Math.abs(x - 3824.774) < 4 && isHuancavelicaV2Solid(room,x,y));
  advance(room, q.beamAt);
  assert.ok(room.arena.craters.length > 0, 'beam creates bitmap cuts at its final geometry');
  assert.equal(isHuancavelicaV2Solid(room,x,y), false, 'contact rock must not remain solid');
}));

test('CSW-06 composed: central Air Strike shell cuts its upper contact, never the legacy parent island', () => fixture('airstrike', (room, q) => {
  const shell = q.airStrikeShells[3];
  assert.equal(shell.x,q.targetX,'zone follows the definitive designator, not legacy X=1714');
  assert.ok(Math.abs(shell.y - 861.56) < 4, 'first upper contact in the corrected target column');
  const until = shell.impactAt + 10_000;
  for (let time = q.warningUntil; time <= until && !shell.applied; time += 50) advance(room,time);
  const crater = room.arena.craters.find(c => c.id === `${q.id}-air-${shell.index}` || c.impactId === shell.id);
  assert.ok(crater, 'central shell has its own crater');
  assert.ok(Math.abs(crater.y - shell.y) < 4, `shell y=${shell.y}, crater y=${crater.y}`);
}));

for(const weapon of ['cluster','airstrike','nuke','triple']) {
  test(`composed ${weapon}: stable contacts, deterministic replay, duplicate ticks and pure serialization`,()=>fixture(weapon,(room,q)=>{
    complete(room); validateCuts(room,q);
    assert.deepEqual(huancavelicaV2MaskForRoom(room),huancavelicaV2MaskForRoom({arena:{craters:structuredClone(room.arena.craters)}}));
    const state=structuredClone(room);
    publicRoomState9(room);publicRoomState9(room);assert.deepEqual(room,state);
    advance(room,now);assert.deepEqual(room,state);
    assert.ok(q.impacts.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.impactAt)));
  }));
}

for(const [name,imageX,imageY] of [['broad main ground',281,379],['upper island',730,89],['lower island',730,786],['side wall',1118,250]]) {
  test(`composed Cluster ${name}: real launch arc, independent current bitmap child contacts`,()=>fixture('cluster',(room,q)=>{
    assert.ok(q.clusterImpacts.length===5);
    if(name==='lower island')assert.ok(q.durationMs>500,'paced muzzle overlap must not become an immediate self hit');
    for(const child of q.clusterImpacts){
      assert.ok(Math.hypot(child.startX-q.impactX,child.startY-q.impactY)<=6.01);
      assert.equal(child.visualStartAt,q.impactAt+667+child.index*167);
      assert.equal(child.vx,[-180,-90,0,90,180][child.index]/1.333);
    }
    complete(room);validateCuts(room,q);
    assert.ok(q.impacts.filter(e=>e.terrainCuts.length).length>=2,'multiple real child cuts');
  },{setup:room=>{
    const p=room.players[1],x=imageX*scale,y=findHuancavelicaV2SurfaceBelow(room,x,Math.max(0,imageY*scale-40));
    p.spawn={x,y:y-8,facing:x<2500?1:-1};setAim9('b',name==='lower island'?85:45,name==='lower island'?10:55);
  }}));
}

test('composed Cluster: previous and overlapping cuts change later contacts, never old child Y',()=>fixture('cluster',(room,q)=>{
  const child=q.clusterImpacts[2],originalY=child.y;
  room.arena.craters.push({id:'precut',x:child.x,y:child.y,radius:150,depth:70});
  // Removing rock during the parent event reforecasts every pending child.
  complete(room);validateCuts(room,q);
  assert.ok(Math.abs(child.y-originalY)>20 || child.impactReason==='player' || child.impactReason==='out_of_bounds');
}));

test('composed Air Strike: shells hit multiple heights and pre-cut columns with their own identities',()=>fixture('airstrike',(room,q)=>{
  const expected=q.airStrikeShells.map(s=>s.y);
  assert.ok(Math.max(...expected)-Math.min(...expected)>200);
  room.arena.craters.push({id:'air-precut',x:q.airStrikeShells[3].x,y:q.airStrikeShells[3].y,radius:95,depth:62});
  complete(room);validateCuts(room,q);
  const center=q.impacts[3];
  assert.notEqual(center.y,expected[3]);
  for(const e of q.impacts){assert.equal(e.flight.id,e.id);assert.equal(e.flight.y,e.y);assert.equal(e.flight.impactAt,e.impactAt);}
}));

test('composed Nuke: coherent full beam cuts every sampled rock pixel across several masses, including pre-cut rock',()=>fixture('nuke',(room,q)=>{
  // Authored diagonal segment through upper/right + central rock masses.
  const e=q.impacts[0];e.beam=q.nukeBeam={ax:1650,ay:500,bx:4200,by:1450,halfWidth:115};
  e.x=q.targetX=2925;e.y=q.targetY=975;
  room.arena.craters.push({id:'nuke-precut',x:3800,y:1300,radius:70,depth:330});
  const samples=[];
  for(let t=0;t<=1;t+=.005)for(const d of [-110,0,110]){
    const dx=2550,dy=950,len=Math.hypot(dx,dy),x=1650+dx*t-d*dy/len,y=500+dy*t+d*dx/len;
    if(isHuancavelicaV2Solid(room,x,y))samples.push({x,y});
  }
  assert.ok(samples.length>40);assert.ok(samples.some(p=>p.x<2900)&&samples.some(p=>p.x>3300),'separate rock masses');
  advance(room,q.beamAt-1);assert.equal(room.arena.craters.length,1);
  advance(room,q.beamAt);assert.ok(samples.every(p=>!isHuancavelicaV2Solid(room,p.x,p.y)));
  assert.equal(q.beamAt-q.impactAt,5000);assert.equal(q.beamUntil-q.beamAt,5000);
  assert.equal(q.nukeBeam.halfWidth,115);assert.equal(e.damageRule.damage,20);
  complete(room);validateCuts(room,q);
}));

test('composed Nuke: clipped beam retains its diagonal through the final designator',()=>fixture('nuke',(room,q)=>{
  const b=q.nukeBeam;
  const cross=(q.targetX-b.ax)*(b.by-b.ay)-(q.targetY-b.ay)*(b.bx-b.ax);
  assert.ok(Math.abs(cross)<.001);assert.ok(b.ax>=30&&b.bx<=4970&&b.ay>=0&&b.by<=3750);
  assert.ok(Math.abs((b.by-b.ay)/(b.bx-b.ax)-320/900)<.0001);
}));

for(const weapon of ['cluster','airstrike','triple','nuke']) {
  test(`composed ${weapon}: batched and fine-grained ticks yield identical contacts, cuts and damage`,()=>{
    const outcomes=[];
    for(const step of [50,30000])fixture(weapon,(room,q)=>{
      complete(room,step);
      outcomes.push({players:room.players.map(p=>({hp:p.hp,alive:p.alive,spawn:p.spawn})),
        impacts:q.impacts.map(e=>({x:e.x,y:e.y,type:e.contactType,damage:e.damageResults,cuts:e.terrainCuts.map(c=>({x:c.x,y:c.y,radius:c.radius}))}))});
    });
    assert.deepEqual(outcomes[1],outcomes[0]);
  });
}

for(const weapon of ['triple','cluster','airstrike','nuke'])for(const mode of ['team','survival']) {
  test(`composed ${weapon}/${mode}: real KO, winner, attribution, no resurrection and clean rematch`,()=>fixture(weapon,(room,q)=>{
    const target=room.players[0],e=q.impacts.find(e=>e.damageRule.damage>0);
    // Isolate damage from support loss: direct contact above broad solid ground.
    Object.assign(e,{flight:null,x:target.spawn.x,y:target.spawn.y-10,contactType:'player',targetPlayerId:'a'});
    if(e.damageRule.kind==='beam')e.beam={ax:target.spawn.x-100,ay:target.spawn.y-10,bx:target.spawn.x+100,by:target.spawn.y-10,halfWidth:115};
    target.hp=1;
    const state=complete(room);
    assert.equal(state.status,'finished');assert.equal(state.match.result.draw,false);
    assert.equal(state.match.pendingResult,null);
    if(mode==='team')assert.equal(state.match.result.winnerTeam,room.players[1].team);else assert.equal(state.match.result.winnerPlayerId,'b');
    assert.equal(state.matchStats.find(s=>s.playerId==='a').deaths,1);
    assert.equal(state.matchStats.find(s=>s.playerId==='b').kills,1);
    assert.equal(state.matchStats.find(s=>s.playerId==='a').damageReceived,1);
    assert.ok(state.eventFeed.filter(e=>e.type==='death').every(event=>event.attackId===q.id&&event.impactId));
    const finished=structuredClone(room);advance(room,now+5000);assert.deepEqual(room,finished);
    assert.equal(rematchRoom9('a',{randomMap:false}).ok,true);
    assert.equal(room.arena.craters.length,0);assert.equal(room.match.projectile,null);
    const fresh=structuredClone(room);advance(room,now+100);publicRoomState9(room);assert.deepEqual(room,fresh);
  },{mode}));
}

for(const weapon of ['cluster','triple','airstrike','nuke']) {
  test(`composed ${weapon}: Shield covers complete attack once with invariant rounding and final statistics`,()=>fixture(weapon,(room,q)=>{
    const target=room.players[0],x=target.spawn.x,y=target.spawn.y-10;
    for(const e of q.impacts){
      e.flight=null;Object.assign(e,{x,y,contactType:'player',targetPlayerId:target.id});
      e.damageRule={...e.damageRule,cutRadius:0};
      if(e.beam)e.beam={ax:x-100,ay:y,bx:x+100,by:y,halfWidth:115};
    }
    // Shared pending impact contract is driven through the real composed advance.
    complete(room);
    const raw=q.impacts.reduce((n,e)=>n+e.damageRule.damage,0);
    assert.equal(target.hp,100-Math.ceil(raw*.5));assert.equal(target.shield,null);assert.equal(target.alive,true);
    assert.equal(publicRoomState9(room).matchStats.find(s=>s.playerId==='a').damageReceived,Math.ceil(raw*.5));
    assert.equal(q.impacts.reduce((n,e)=>n+e.damageResults.filter(d=>d.playerId==='a').reduce((s,d)=>s+d.damage,0),0),Math.ceil(raw*.5));
  },{setup:room=>{room.players[0].shield={factor:.5};}}));
}

for(const weapon of ['cluster','airstrike','nuke'])for(const mode of ['team','survival']) {
  test(`composed ${weapon}/${mode}: simultaneous KO is a definitive DRAW, no duplicate deaths`,()=>fixture(weapon,(room,q)=>{
    const point={...room.players[0].spawn};
    for(const p of room.players){p.spawn={...point};p.hp=1;}
    const e=q.impacts.find(e=>e.damageRule.kind!=='direct');
    e.flight=null;Object.assign(e,{x:point.x,y:point.y-10,contactType:'terrain'});
    if(e.beam)e.beam={ax:point.x-100,ay:point.y-10,bx:point.x+100,by:point.y-10,halfWidth:115};
    const state=complete(room);
    assert.equal(state.match.result.draw,true);assert.equal(state.match.pendingResult,null);
    assert.equal(state.matchStats.reduce((n,s)=>n+s.deaths,0),2);
    assert.equal(state.eventFeed.filter(e=>e.type==='death').length,2);
  },{mode}));
}

for(const weapon of ['cluster','airstrike','nuke','triple']) {
  test(`composed ${weapon}: repeated impact advances cannot repeat damage or cuts`,()=>fixture(weapon,(room,q)=>{
    let applied=0;
    for(let tick=0;tick<1000&&room.match.projectile;tick++){
      advance(room,now+50);
      if(q.impacts.filter(e=>e.resolved).length>applied){
        applied=q.impacts.filter(e=>e.resolved).length;
        const state=structuredClone(room);advance(room,now);assert.deepEqual(room,state);
      }
    }
    assert.equal(applied,q.impacts.length);assert.equal(room.match.projectile,null);
  }));
}

test('composed Cluster: nearby live target takes child damage at real current contacts',()=>fixture('cluster',(room,q)=>{
  const target=room.players[0],x=q.impactX+80,surface=findHuancavelicaV2SurfaceBelow(room,x,q.impactY-100);
  assert.ok(surface!=null);target.spawn={x,y:surface-8,facing:-1};
  complete(room);validateCuts(room,q);
  const childDamage=q.impacts.slice(1).flatMap(e=>e.damageResults).filter(d=>d.playerId==='a');
  assert.ok(childDamage.length>0,'real child contact affects nearby player');
  const allDamage=q.impacts.flatMap(e=>e.damageResults).filter(d=>d.playerId==='a');
  assert.equal(publicRoomState9(room).matchStats.find(s=>s.playerId==='a').damageReceived,allDamage.reduce((n,d)=>n+d.damage,0));
},{setup:room=>{
  const x=730*scale,y=findHuancavelicaV2SurfaceBelow(room,x,786*scale-40);
  room.players[1].spawn={x,y:y-8,facing:-1};setAim9('b',85,10);
}}));

test('composed utilities retain Heal +20 and Shield while no projectile is active',()=>fixture('heal',(room,q)=>{
  assert.equal(q,null);assert.equal(room.players[1].hp,85);assert.equal(room.match.activePlayerId,'b');
  room.players[1].inventory=[{type:'shield',label:'SHIELD'},null];room.players[1].selectedItemSlot=2;
  assert.equal(fireProjectile9('b').ok,true);assert.ok(room.players[1].shield);assert.equal(room.match.projectile,null);
},{setup:room=>{room.players[1].hp=65;}}));

for(const map of ['rolling','terraces','twinpeaks','basin','brokenridge','islands','canyon'])for(const weapon of ['triple','cluster','airstrike','nuke']) {
  test(`composed legacy ${map}/${weapon}: no v2 contract leaks into the supported resolver`,()=>fixture(weapon,(room,q)=>{
    assert.equal(q.impactContract,undefined);complete(room);
    assert.equal(room.arena.collisionModel,undefined);
    assert.ok(room.arena.craters.every(c=>Number.isFinite(c.depth)));
  },{map}));
}
