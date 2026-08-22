// In-memory room store for the first single-instance Cloud Run architecture.
// Room creation/join/ready logic belongs to Phase 1.
export const roomStore = new Map();

export function getRoom(roomCode) {
  return roomStore.get(roomCode) ?? null;
}
