import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRoom, createRoom, joinRoom, roomStore, setGameMode, setPlayerReady, startRoom } from '../rooms.js';
import { ensureAfkVoteState, registerActiveTurnActivity, toggleAfkSkipVote, afkVoteTestHooks } from '../afk-vote.js';

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

test('AFK voting opens 20 seconds after the active player last showed activity',()=>{
  const room=started(),activeId=room.match.activePlayerId;
  const t=1_000_000;
  room.match.turnStartedAt=t;
  room.match.afkSkipVote=null;
  let vote=ensureAfkVoteState(room,t);
  assert.equal(vote.eligibleAt,t+afkVoteTestHooks.AFK_INACTIVITY_MS);
  assert.equal(registerActiveTurnActivity(room,activeId,t+12_000),true);
  vote=room.match.afkSkipVote;
  assert.equal(vote.lastActivityAt,t+12_000);
  assert.equal(vote.eligibleAt,t+32_000);
  assert.deepEqual(vote.votes,[]);
});

test('F1 vote stays locked before 20 seconds of inactivity and unlocks exactly at the threshold',()=>{
  const room=started(),activeId=room.match.activePlayerId,spectator=room.players.find(p=>p.id!==activeId);
  const t=2_000_000;
  room.match.turnStartedAt=t;
  room.match.afkSkipVote=null;
  ensureAfkVoteState(room,t);
  registerActiveTurnActivity(room,activeId,t+5_000);
  assert.equal(toggleAfkSkipVote(spectator.id,t+24_999).error,'afk_vote_locked');
  const open=toggleAfkSkipVote(spectator.id,t+25_000);
  assert.equal(open.ok,true);
  assert.equal(open.voted,true);
});
