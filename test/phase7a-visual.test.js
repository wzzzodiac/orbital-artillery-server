import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { advanceTurnIfDue7AVisual, fireProjectile7AVisual } from '../phase7a-visual.js';

function started(ids=['a','b']){
  roomStore.clear();
  const [host,...rest]=ids;
  const room=createRoom(host,host.toUpperCase()).room;
  for(const id of rest)assert.equal(joinRoom(room.code,id,id.toUpperCase()).ok,true);
  assert.equal(setGameMode(host,'survival').ok,true);
  for(const id of ids)assert.equal(setPlayerReady(id,true).ok,true);
  assert.equal(startRoom(host).ok,true);
  activateRoom(room.code,room.match.startAt);
  return room;
}
function equip(room,type,label){
  const id=room.match.activePlayerId,p=room.players.find(x=>x.id===id);
  p.inventory=[{type,label},null];p.selectedItemSlot=2;p.motion=null;
  return {id,p};
}

test('Air Strike reserves six seconds per shell for slow full-screen descent',()=>{
  const room=started();const {id}=equip(room,'airstrike','AIR STRIKE');
  const r=fireProjectile7AVisual(id);assert.equal(r.ok,true);
  const q=room.match.projectile;assert.equal(q.weaponType,'airstrike');assert.equal(q.airStrikeShells.length,7);
  for(const shell of q.airStrikeShells){assert.equal(shell.impactAt-shell.visualStartAt,6000);assert.ok(shell.startY<=shell.y-800||shell.startY===80);}
  for(let i=1;i<q.airStrikeShells.length;i++)assert.equal(q.airStrikeShells[i].visualStartAt-q.airStrikeShells[i-1].visualStartAt,350);
  assert.equal(room.match.turnEndsAt,q.resolveAt);
});

test('Nuke applies 20 direct damage but creates only a shallow diagonal scar, never abyss-depth craters',()=>{
  const room=started(['a','b','c']);const {id,p:shooter}=equip(room,'nuke','NUKE LASER');
  const target=room.players.find(x=>x.id!==id);target.hp=100;
  const r=fireProjectile7AVisual(id);assert.equal(r.ok,true);
  const q=room.match.projectile;
  const now=Date.now();
  q.nukeBeam={ax:target.spawn.x-500,ay:target.spawn.y-10,bx:target.spawn.x+500,by:target.spawn.y-10,halfWidth:115};
  q.targetX=target.spawn.x;q.beamAt=now;q.beamUntil=now+5000;q.resolveAt=now+6500;
  const before=room.arena.craters.length;
  advanceTurnIfDue7AVisual(room.code,now);
  assert.equal(target.hp,80);
  const scars=room.arena.craters.slice(before).filter(c=>String(c.id).includes('nuke-scar'));
  assert.ok(scars.length>0);
  assert.ok(scars.every(c=>c.depth===230));
  assert.ok(scars.every(c=>c.depth<500),'Nuke terrain deformation must remain a survivable scar, not a vertical void');
  assert.deepEqual(q.pendingVoidDeathIds,[]);
  assert.equal(shooter.alive,true);
});
