import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateRoom,
  createRoom,
  getRoom,
  joinRoom,
  roomStore,
  setGameMode,
  setPlayerReady,
  startRoom
} from '../rooms.js';
import { advanceTurnIfDue7AVisual } from '../phase7a-visual.js';

function startedTwoPlayerSurvival(){
  roomStore.clear();
  const room=createRoom('a','A').room;
  assert.equal(joinRoom(room.code,'b','B').ok,true);
  assert.equal(setGameMode('a','survival').ok,true);
  assert.equal(setPlayerReady('a',true).ok,true);
  assert.equal(setPlayerReady('b',true).ok,true);
  assert.equal(startRoom('a').ok,true);
  activateRoom(room.code,room.match.startAt);
  return getRoom(room.code);
}

test('100 full turn timeouts cannot end a match while both tanks still have HP',()=>{
  const room=startedTwoPlayerSurvival();
  for(let i=0;i<100;i+=1){
    assert.equal(room.players.length,2);
    assert.ok(room.players.every(player=>player.hp>0));
    assert.equal(room.status,'started');
    assert.equal(room.match.result,null);
    const advanced=advanceTurnIfDue7AVisual(room.code,room.match.turnEndsAt+1);
    assert.ok(advanced,`turn ${i+1} should advance normally`);
    assert.equal(room.status,'started',`turn ${i+1} must not finish the match`);
    assert.equal(room.match.result,null,`turn ${i+1} must not invent a winner`);
  }
  assert.ok(room.match.turnNumber>=101);
  assert.equal(room.players.filter(player=>player.hp>0).length,2);
});
