// In-memory room store for the first single-instance Cloud Run architecture.
// Room creation/join/ready logic belongs to Phase 1.
import { CONFIG } from './config.js';

export const roomStore = new Map();

export function getRoom(roomCode) {
  return roomStore.get(roomCode) ?? null;
}

export function canCreateRoom() {
  return roomStore.size < CONFIG.maxRooms;
}
