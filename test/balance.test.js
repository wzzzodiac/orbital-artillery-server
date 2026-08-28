import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateRoom,
  createRoom,
  joinRoom,
  roomStore,
  setGameMode,
  setPlayerReady,
  startRoom
} from '../rooms.js';
import {
  PHASE6E_ITEM_POOL,
  PHASE6E_POOL_TOTAL,
  chooseBalancedItem6E,
  publicRoomState6E
} from '../phase6e.js';

function makeStartedRoom(){
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

test('Phase 6E pickup pool is an exact 100-point distribution',()=>{
  assert.equal(PHASE6E_POOL_TOTAL,100);
  assert.deepEqual(PHASE6E_ITEM_POOL.map(({type,weight})=>[type,weight]),[
    ['heavy',25],
    ['triple',20],
    ['cluster',20],
    ['shield',12],
    ['heal',12],
    ['airstrike',8],
    ['nuke',3]
  ]);
});

test('Phase 6E deterministic roll boundaries match the declared weights',()=>{
  const boundaries=[
    [0,'heavy'],[24,'heavy'],
    [25,'triple'],[44,'triple'],
    [45,'cluster'],[64,'cluster'],
    [65,'shield'],[76,'shield'],
    [77,'heal'],[88,'heal'],
    [89,'airstrike'],[96,'airstrike'],
    [97,'nuke'],[99,'nuke']
  ];
  for(const [roll,type] of boundaries)assert.equal(chooseBalancedItem6E(roll).type,type,`roll ${roll}`);
  assert.throws(()=>chooseBalancedItem6E(-1),RangeError);
  assert.throws(()=>chooseBalancedItem6E(100),RangeError);
});

test('Phase 6E public state exposes the balanced pool and current pacing baseline',()=>{
  const room=makeStartedRoom();
  const state=publicRoomState6E(room);
  assert.equal(state.phase,'6E');
  assert.equal(state.itemPool.reduce((sum,item)=>sum+item.weight,0),100);
  assert.deepEqual(state.balanceRules.weights,{heavy:25,triple:20,cluster:20,shield:12,heal:12,airstrike:8,nuke:3});
  assert.equal(state.balanceRules.turnSeconds,40);
  assert.equal(state.balanceRules.pickupEveryTurns,3);
  assert.equal(state.balanceRules.pickupLifetimeTurns,4);
  assert.equal(state.balanceRules.maxPickups,2);
  assert.equal(state.balanceRules.freeMovement,true);
  assert.equal(state.balanceRules.jumpCooldownMs,450);
});

test('a newly spawned pickup is normalized exactly once by Phase 6E',()=>{
  const room=makeStartedRoom();
  room.pickups=[];
  room.lastPickupSpawnTurn=0;
  room.match.turnNumber=3;
  const firstState=publicRoomState6E(room);
  assert.equal(room.pickups.length,1);
  const box=room.pickups[0];
  assert.equal(box.phase6ePoolRolled,true);
  assert.ok(PHASE6E_ITEM_POOL.some(item=>item.type===box.type));
  assert.equal('phase6cPoolRolled' in firstState.pickups[0],false);
  assert.equal('phase6dPoolRolled' in firstState.pickups[0],false);
  assert.equal('phase6ePoolRolled' in firstState.pickups[0],false);
  const typeAfterFirstRoll=box.type;
  const secondState=publicRoomState6E(room);
  assert.equal(box.type,typeAfterFirstRoll);
  assert.equal('phase6ePoolRolled' in secondState.pickups[0],false);
});
