import { GAME_CONSTANTS } from './shared/constants.js';

export function createTurnState(playerId, now = Date.now()) {
  return {
    playerId,
    startedAt: now,
    endsAt: now + GAME_CONSTANTS.DEFAULT_TURN_SECONDS * 1000
  };
}
