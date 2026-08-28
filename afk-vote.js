import { findRoomBySocket } from './rooms.js';

const AFK_VOTE_REMAINING_MS = 20_000;
const SKIP_NOTICE_MS = 1_500;

function eligibleVoterIds(room) {
  const activeId = room.match?.activePlayerId;
  return room.players
    .filter(player => player.alive !== false && player.id !== activeId)
    .map(player => player.id);
}

function requiredVotesFor(count) {
  return count > 0 ? Math.floor(count / 2) + 1 : 0;
}

function markTurnSkipped(room, vote, now) {
  if (!room?.match || !vote) return false;
  if (room.match.lastAfkSkip?.skippedTurnNumber === (room.match.turnNumber ?? 0)) return true;
  const skippedPlayer = room.players.find(player => player.id === room.match.activePlayerId);
  room.match.lastAfkSkip = {
    playerId: room.match.activePlayerId,
    playerName: skippedPlayer?.name ?? null,
    skippedTurnNumber: room.match.turnNumber ?? 0,
    at: now,
    expiresAt: now + SKIP_NOTICE_MS,
    previousTurnEndsAt: room.match.turnEndsAt ?? null
  };
  room.match.turnEndsAt = now;
  return true;
}

function maybePassVote(room, vote, now = Date.now()) {
  if (!room?.match || !vote || room.match.projectile) return false;
  if (now < vote.eligibleAt) return false;
  if ((room.match.turnEndsAt ?? now) - now > AFK_VOTE_REMAINING_MS) return false;
  if (vote.requiredVotes <= 0 || (vote.votes?.length ?? 0) < vote.requiredVotes) return false;
  return markTurnSkipped(room, vote, now);
}

export function ensureAfkVoteState(room, now = Date.now()) {
  if (!room?.match || room.status !== 'started' || !room.match.activePlayerId) return null;

  const turnNumber = room.match.turnNumber ?? 0;
  const eligibleIds = eligibleVoterIds(room);
  const requiredVotes = requiredVotesFor(eligibleIds.length);
  const existing = room.match.afkSkipVote;

  if (!existing || existing.turnNumber !== turnNumber) {
    room.match.afkSkipVote = {
      turnNumber,
      eligibleAt: (room.match.turnStartedAt ?? now) + AFK_VOTE_REMAINING_MS,
      votes: [],
      requiredVotes,
      eligibleVoters: eligibleIds.length,
      lastActivityAt: room.match.turnStartedAt ?? now
    };
    return room.match.afkSkipVote;
  }

  existing.votes = (existing.votes ?? []).filter(id => eligibleIds.includes(id));
  existing.requiredVotes = requiredVotes;
  existing.eligibleVoters = eligibleIds.length;
  maybePassVote(room, existing, now);
  return existing;
}

export function registerActiveTurnActivity(room, socketId, now = Date.now()) {
  if (!room?.match || room.status !== 'started' || room.match.activePlayerId !== socketId) return false;

  const currentTurn = room.match.turnNumber ?? 0;
  const existingVote = room.match.afkSkipVote;
  if (existingVote?.turnNumber === currentTurn) existingVote.votes = [];

  const pendingSkip = room.match.lastAfkSkip;
  if (pendingSkip?.skippedTurnNumber === currentTurn) {
    const previousDeadline = Number(pendingSkip.previousTurnEndsAt);
    if (Number.isFinite(previousDeadline) && previousDeadline > now) room.match.turnEndsAt = previousDeadline;
    room.match.lastAfkSkip = null;
  }

  const vote = ensureAfkVoteState(room, now);
  if (!vote) return false;
  vote.lastActivityAt = now;
  vote.votes = [];
  return true;
}

export function toggleAfkSkipVote(socketId, now = Date.now()) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'started' || !room.match?.activePlayerId) return { ok: false, error: 'match_not_started' };
  if (room.match.projectile) return { ok: false, error: 'afk_vote_unavailable' };
  if (room.match.activePlayerId === socketId) return { ok: false, error: 'cannot_vote_own_turn' };

  const voter = room.players.find(player => player.id === socketId);
  if (!voter || voter.alive === false) return { ok: false, error: 'afk_vote_ineligible' };

  const vote = ensureAfkVoteState(room, now);
  if (!vote || now < vote.eligibleAt || (room.match.turnEndsAt ?? now) - now > AFK_VOTE_REMAINING_MS) {
    return { ok: false, error: 'afk_vote_locked' };
  }

  const votes = new Set(vote.votes ?? []);
  let voted;
  if (votes.has(socketId)) {
    votes.delete(socketId);
    voted = false;
  } else {
    votes.add(socketId);
    voted = true;
  }
  vote.votes = [...votes];

  const skipped = maybePassVote(room, vote, now);
  return { ok: true, room, skipped, voted };
}
