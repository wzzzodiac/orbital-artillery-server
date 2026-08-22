import { randomInt } from 'node:crypto';
import { CONFIG } from './config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_TEAMS = new Set(['A', 'B']);
const ARENA_WIDTH = 1600;
const ARENA_HEIGHT = 900;

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
    isHost: player.id === hostId,
    spawn: player.spawn ?? null
  };
}

export function publicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    maxPlayers: CONFIG.maxPlayers,
    arena: room.arena ?? null,
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
    arena: null,
    players: [{ id: socketId, name: playerName, ready: false, team: 'A', spawn: null }]
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
  room.players.push({ id: socketId, name: playerName, ready: false, team: teamA <= teamB ? 'A' : 'B', spawn: null });
  return { ok: true, room };
}

export function findRoomBySocket(socketId) {
  for (const room of roomStore.values()) {
    if (room.players.some(player => player.id === socketId)) return room;
  }
  return null;
}

export function setPlayerReady(socketId, ready) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };

  const player = room.players.find(entry => entry.id === socketId);
  player.ready = Boolean(ready);
  return { ok: true, room };
}

export function setPlayerTeam(socketId, team) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (!VALID_TEAMS.has(team)) return { ok: false, error: 'invalid_team' };

  const player = room.players.find(entry => entry.id === socketId);
  if (player.team === team) return { ok: true, room };

  const teamCount = room.players.filter(entry => entry.team === team).length;
  if (teamCount >= 4) return { ok: false, error: 'team_full' };

  player.team = team;
  player.ready = false;
  return { ok: true, room };
}

function assignArena(room) {
  const teamA = room.players.filter(player => player.team === 'A');
  const teamB = room.players.filter(player => player.team === 'B');
  const leftSlots = [
    { x: 190, y: 620 },
    { x: 335, y: 575 },
    { x: 480, y: 625 },
    { x: 610, y: 555 }
  ];
  const rightSlots = [
    { x: 1410, y: 620 },
    { x: 1265, y: 575 },
    { x: 1120, y: 625 },
    { x: 990, y: 555 }
  ];

  teamA.forEach((player, index) => {
    player.spawn = { ...leftSlots[index], facing: 1 };
  });
  teamB.forEach((player, index) => {
    player.spawn = { ...rightSlots[index], facing: -1 };
  });

  room.arena = {
    id: 'phase2-valley-01',
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    seed: room.code,
    generatedAt: Date.now()
  };
}

export function startRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return { ok: false, error: 'not_in_room' };
  if (room.status !== 'lobby') return { ok: false, error: 'room_already_started' };
  if (room.hostId !== socketId) return { ok: false, error: 'host_only' };
  if (room.players.length < 2) return { ok: false, error: 'not_enough_players' };
  if (!room.players.every(player => player.ready)) return { ok: false, error: 'players_not_ready' };

  const teamA = room.players.filter(player => player.team === 'A').length;
  const teamB = room.players.filter(player => player.team === 'B').length;
  if (teamA === 0 || teamB === 0) return { ok: false, error: 'both_teams_required' };

  assignArena(room);
  room.status = 'started';
  room.startedAt = Date.now();
  return { ok: true, room };
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
  if (room.status === 'lobby') {
    for (const player of room.players) player.ready = false;
  }
  return { deleted: false, roomCode: room.code, room };
}
