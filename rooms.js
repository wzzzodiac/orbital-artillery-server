import { randomInt } from 'node:crypto';
import { CONFIG } from './config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const roomStore = new Map();

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!roomStore.has(code)) return code;
  }
  throw new Error('room_code_generation_failed');
}

function publicPlayer(player, hostId) {
  return {
    id: player.id,
    name: player.name,
    ready: player.ready,
    team: player.team,
    isHost: player.id === hostId
  };
}

export function publicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    maxPlayers: CONFIG.maxPlayers,
    players: room.players.map(player => publicPlayer(player, room.hostId))
  };
}

export function getRoom(roomCode) {
  return roomStore.get(roomCode) ?? null;
}

export function canCreateRoom() {
  return roomStore.size < CONFIG.maxRooms;
}

export function createRoom(socketId, playerName) {
  if (!canCreateRoom()) return { ok: false, error: 'server_room_capacity' };

  const code = generateRoomCode();
  const room = {
    code,
    status: 'lobby',
    hostId: socketId,
    createdAt: Date.now(),
    players: [{ id: socketId, name: playerName, ready: false, team: 'A' }]
  };
  roomStore.set(code, room);
  return { ok: true, room };
}

export function joinRoom(roomCode, socketId, playerName) {
  const room = getRoom(roomCode);
  if (!room) return { ok: false, error: 'room_not_found' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.players.length >= CONFIG.maxPlayers) return { ok: false, error: 'room_full' };
  if (room.players.some(player => player.id === socketId)) return { ok: true, room };

  const teamA = room.players.filter(player => player.team === 'A').length;
  const teamB = room.players.filter(player => player.team === 'B').length;
  room.players.push({ id: socketId, name: playerName, ready: false, team: teamA <= teamB ? 'A' : 'B' });
  return { ok: true, room };
}

export function findRoomBySocket(socketId) {
  for (const room of roomStore.values()) {
    if (room.players.some(player => player.id === socketId)) return room;
  }
  return null;
}

export function removePlayer(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;

  room.players = room.players.filter(player => player.id !== socketId);
  if (room.players.length === 0) {
    roomStore.delete(room.code);
    return { deleted: true, roomCode: room.code, room: null };
  }

  if (room.hostId === socketId) room.hostId = room.players[0].id;
  return { deleted: false, roomCode: room.code, room };
}
