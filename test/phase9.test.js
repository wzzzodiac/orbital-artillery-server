import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { phase9TestHooks, publicRoomState9 } from '../phase9.js';

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

test('v0.9 pickup frenzy starts at turn 10, spawns at most once per turn, and caps the map at four',()=>{
  const room=started();
  room.pickups=[];room.match.turnNumber=10;room.phase9PickupAttemptTurn=0;
  assert.equal(phase9TestHooks.maintainPhase9Pickups(room),true);
  assert.equal(room.pickups.length,1);
  assert.equal(room.pickups[0].spawnTurn,10);
  assert.equal(phase9TestHooks.maintainPhase9Pickups(room),false);
  assert.equal(room.pickups.length,1);
  for(let turn=11;turn<=13;turn+=1){room.match.turnNumber=turn;assert.equal(phase9TestHooks.maintainPhase9Pickups(room),true);}
  assert.equal(room.pickups.length,4);
  room.match.turnNumber=14;
  assert.equal(phase9TestHooks.maintainPhase9Pickups(room),false);
  assert.equal(room.pickups.length,4);
});

test('a player can collect only one pickup per turn even when two boxes overlap',()=>{
  const room=started(),player=room.players.find(p=>p.id===room.match.activePlayerId);
  room.match.turnNumber=10;player.inventory=[null,null];player.pickupCollectedTurn=-1;
  room.pickups=[
    {id:'one',type:'heavy',label:'HEAVY BOMB',x:player.spawn.x,y:player.spawn.y-8,spawnTurn:10,expiresAfterTurn:13},
    {id:'two',type:'triple',label:'TRIPLE SHOT',x:player.spawn.x,y:player.spawn.y-8,spawnTurn:10,expiresAfterTurn:13}
  ];
  assert.equal(phase9TestHooks.collectOneByTouch(room,player),true);
  assert.equal(player.inventory.filter(Boolean).length,1);
  assert.equal(room.pickups.length,1);
  assert.equal(phase9TestHooks.collectOneByTouch(room,player),false);
  assert.equal(player.inventory.filter(Boolean).length,1);
  assert.equal(room.pickups.length,1);
  room.match.turnNumber=11;
  assert.equal(phase9TestHooks.collectOneByTouch(room,player),true);
  assert.equal(player.inventory.filter(Boolean).length,2);
  assert.equal(room.pickups.length,0);
});

test('public v0.9 state advertises frenzy pacing, four-box cap and touch-only collection',()=>{
  const room=started();
  const state=publicRoomState9(room);
  assert.equal(state.version,'0.9-beta');
  assert.equal(state.phase,'9');
  assert.equal(state.pickupRules.earlyEveryTurns,3);
  assert.equal(state.pickupRules.frenzyStartsAtTurn,10);
  assert.equal(state.pickupRules.frenzyEveryTurns,1);
  assert.equal(state.pickupRules.maxOnMap,4);
  assert.equal(state.pickupRules.maxCollectedPerPlayerTurn,1);
  assert.equal(state.pickupRules.collectByTouch,true);
  assert.equal(state.pickupRules.collectByExplosion,false);
  assert.equal(state.pickupRules.pickupEndsTurn,false);
});
