import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPracticeSession,PRACTICE_LIMITS} from '../simulation/practice.js';
const mask=new Uint8Array(readFileSync(new URL('../assets/huancavelica-v2-terrain-mask.bin',import.meta.url)));
test('TRY IT dummy stays fixed, never gets a turn, repeated attacks continue and reset restores terrain',()=>{
 const s=createPracticeSession(mask,{now:1000000}),initial=s.getState(),dummy=initial.players[1].spawn;let now=1000000;
 for(const weapon of ['basic','heavy','triple','cluster','airstrike','nuke']){
  if(s.getState().players[0].alive===false)s.recoverPlayer();
  assert.equal(s.equip(weapon,now).ok,true);assert.equal(s.command('fire_projectile',{},now).ok,true);
  assert.equal(s.resetDummy(),false,'cannot resurrect in the same resolving attack');
  for(let i=0;i<1800&&s.getState().match.projectile;i++){now+=20;s.tick(now);}
  const state=s.getState();assert.equal(state.match.projectile,null);assert.equal(state.status,'started');assert.equal(state.match.activePlayerId,'local');assert.deepEqual(state.match.turnOrder,['local']);assert.equal(state.match.turnNumber,1);
  assert.deepEqual(state.players[1].spawn,dummy);assert.equal(state.players[1].airborne,null);assert.equal(state.players[1].motion,null);s.resetDummy();assert.equal(s.getState().players[1].hp,100);
 }
 assert.ok(s.getState().arena.craters.length);s.reset(now);const reset=s.getState();assert.equal(reset.attacks,0);assert.equal(reset.arena.craters.length,0);assert.deepEqual(reset.players,initial.players);assert.equal(reset.pickups.length,16);
 s.dispose();assert.equal(s.getState(),null);assert.equal(s.command('jump_player',{},now).error,'session_disposed');assert.equal(s.reset(now),false);
});
test('TRY IT finite pickups, detached snapshots, utility rules and repeated lifecycle',()=>{
 for(let pass=0;pass<20;pass++){
  const s=createPracticeSession(mask,{now:0}),state=s.getState();state.players[0].hp=1;assert.equal(s.getState().players[0].hp,100);
  s.equip('heal',0);assert.equal(s.command('fire_projectile',{},0).error,'heal_full_hp');s.equip('shield',0);assert.equal(s.command('fire_projectile',{},0).ok,true);assert.ok(s.getState().players[0].shield);
  for(let i=1;i<=100;i++)s.tick(i*3000);
  assert.ok(s.getState().pickups.length<=PRACTICE_LIMITS.pickups);assert.ok(s.getState().events.length<=36);
  s.reset(300001);s.dispose();s.tick(300002);assert.equal(s.getState(),null);
 }
});

test('TRY IT100HP dummy can be eliminated by real attacks without ending practice',()=>{
 const s=createPracticeSession(mask,{now:0});let now=0;
 for(let shot=0;shot<12&&s.getState().players[1].alive;shot++){
  s.recoverPlayer();const [p,d]=s.getState().players,dx=d.spawn.x-p.spawn.x-24,dy=d.spawn.y-10-(p.spawn.y-24),speed=815,g=480;
  const disc=speed**4-g*(g*dx*dx-2*dy*speed*speed),angle=Math.atan((speed*speed-Math.sqrt(disc))/(g*dx))*180/Math.PI;
  s.command('set_aim',{angle:Math.max(5,Math.min(85,angle)),power:55},now);s.equip('heavy',now);assert.equal(s.command('fire_projectile',{},now).ok,true);
  for(let i=0;i<1500&&s.getState().match.projectile;i++){now+=20;s.tick(now);}
 }
 const dead=s.getState();assert.equal(dead.players[1].hp,0);assert.equal(dead.players[1].alive,false);assert.equal(dead.status,'started');assert.equal(dead.match.activePlayerId,'local');assert.equal(dead.match.turnNumber,1);
 assert.equal(s.resetDummy(),true);assert.equal(s.getState().players[1].hp,100);s.recoverPlayer();assert.equal(s.command('jump_player',{},now).ok,true);s.dispose();
});

test('TRY IT anchored dummy remains a solid target at0HP so the finishing Triple cannot turn into a long flight',()=>{
 const s=createPracticeSession(mask,{now:0});let now=0;
 for(let shot=0;shot<4;shot++){
  s.equip('triple',now);assert.equal(s.command('fire_projectile',{},now).ok,true);const started=now;
  while(s.getState().match.projectile&&now-started<10000){now+=20;s.tick(now);}
  assert.equal(s.getState().match.projectile,null,'finishing volley settles within10s');
 }
 const dead=s.getState();assert.equal(dead.players[1].hp,0);assert.equal(dead.players[1].alive,false);assert.equal(dead.status,'started');assert.equal(dead.match.activePlayerId,'local');assert.equal(s.resetDummy(),true);assert.equal(s.command('jump_player',{},now).ok,true);s.dispose();
});
test('TRY IT attack budget blocks new cuts without silently restoring terrain',()=>{
 const s=createPracticeSession(mask,{now:0});let now=0;
 // Basic out-of-bounds shots exercise the real command and settlement, not a forged budget.
 for(let attack=0;attack<PRACTICE_LIMITS.attacks;attack++){
  s.recoverPlayer();s.equip('basic',now);s.command('set_aim',{angle:85,power:100},now);
  const r=s.command('fire_projectile',{},now);if(!r.ok){assert.equal(r.error,'arena_budget_reset_required');break;}
  for(let i=0;i<2000&&s.getState().match.projectile;i++){now+=100;s.tick(now);}
 }
 const before=s.getState();assert.equal(s.command('fire_projectile',{},now).error,'arena_budget_reset_required');assert.deepEqual(s.getState(),before);assert.ok(before.arena.craters.length<=512);s.reset(now);assert.equal(s.command('fire_projectile',{},now).ok,true);s.dispose();
});
