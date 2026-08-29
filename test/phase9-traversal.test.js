import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { phase7aHotfixTestHooks } from '../phase7a-hotfix.js';
import { phase9TraversalTestHooks, publicRoomState9 } from '../phase9.js';

function started(){
  roomStore.clear();
  const room=createRoom('a','A').room;
  assert.equal(joinRoom(room.code,'b','B').ok,true);
  assert.equal(setGameMode('a','survival').ok,true);
  assert.equal(setPlayerReady('a',true).ok,true);
  assert.equal(setPlayerReady('b',true).ok,true);
  assert.equal(startRoom('a').ok,true);
  activateRoom(room.code,room.match.startAt);
  return room;
}

test('adaptive ledge vault extends a jump that was truncated against a wall',()=>{
  const room=started(),player=room.players.find(p=>p.id===room.match.activePlayerId);
  const from={x:900,y:Math.round(phase7aHotfixTestHooks.surface(room,900)-8),facing:1};
  player.spawn={x:960,y:Math.round(phase7aHotfixTestHooks.surface(room,960)-8),facing:1};
  player.motion={type:'jump',startedAt:Date.now(),endsAt:Date.now()+300,fromX:from.x,fromY:from.y,toX:960,toY:player.spawn.y,apex:120};
  const changed=phase9TraversalTestHooks.maybeExtendTruncatedJump(room,player,from,1);
  assert.equal(changed,true);
  assert.ok(player.spawn.x-from.x>=210,`expected extended landing, got ${player.spawn.x-from.x}`);
  assert.ok(player.spawn.x-from.x<=420,`adaptive vault exceeded cap: ${player.spawn.x-from.x}`);
  assert.equal(player.motion.adaptiveLedgeVault,true);
  assert.ok(player.motion.apex>=150&&player.motion.apex<=1050);
});

test('adaptive ledge vault never stretches a normal 180-unit jump',()=>{
  const room=started(),player=room.players.find(p=>p.id===room.match.activePlayerId);
  const from={x:900,y:Math.round(phase7aHotfixTestHooks.surface(room,900)-8),facing:1};
  const x=1080,y=Math.round(phase7aHotfixTestHooks.surface(room,x)-8);
  player.spawn={x,y,facing:1};
  player.motion={type:'jump',startedAt:Date.now(),endsAt:Date.now()+500,fromX:from.x,fromY:from.y,toX:x,toY:y,apex:150};
  assert.equal(phase9TraversalTestHooks.maybeExtendTruncatedJump(room,player,from,1),false);
  assert.equal(player.spawn.x,x);
  assert.equal(player.motion.adaptiveLedgeVault,undefined);
});

test('public movement contract advertises adaptive ledge vault without changing normal jump distance',()=>{
  const room=started(),state=publicRoomState9(room);
  assert.equal(state.movementRules.adaptiveLedgeVault,true);
  assert.equal(state.movementRules.normalJumpDistance,180);
  assert.equal(state.movementRules.adaptiveMaxDistance,420);
  assert.equal(state.movementRules.adaptiveMaxApex,1050);
});
