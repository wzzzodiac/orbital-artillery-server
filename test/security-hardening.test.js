import test from 'node:test';
import assert from 'node:assert/strict';

import { clientIpFromRequest, isOriginAllowed } from '../request-security.js';
import { cleanupExpiredLobbies, createRoom, joinRoom, roomStore } from '../rooms.js';

function request(remoteAddress, headers = {}) {
  return { headers, socket: { remoteAddress } };
}

test.afterEach(() => roomStore.clear());

test('browser origins are allowlisted while missing Origin follows policy', () => {
  const allowed = ['https://wzzzodiac.github.io', 'http://127.0.0.1:4173'];
  assert.equal(isOriginAllowed(request('127.0.0.1', { origin: allowed[0] }), allowed, true), true);
  assert.equal(isOriginAllowed(request('127.0.0.1', { origin: allowed[1] }), allowed, true), true);
  assert.equal(isOriginAllowed(request('127.0.0.1', { origin: 'https://evil.example' }), allowed, true), false);
  assert.equal(isOriginAllowed(request('127.0.0.1'), allowed, true), true);
  assert.equal(isOriginAllowed(request('127.0.0.1'), allowed, false), false);
  assert.equal(isOriginAllowed(request('127.0.0.1', { origin: 'null' }), allowed, true), false);
});

test('client identity ignores spoofed forwarding unless proxy hops are trusted', () => {
  assert.equal(clientIpFromRequest(request('203.0.113.20')), '203.0.113.20');
  assert.equal(clientIpFromRequest(request('203.0.113.20', { 'x-forwarded-for': '198.51.100.7' }), 0), '203.0.113.20');
  assert.equal(clientIpFromRequest(request('10.0.0.8', { 'x-forwarded-for': '198.51.100.7' }), 1), '198.51.100.7');
  assert.equal(clientIpFromRequest(request('10.0.0.8', { 'x-forwarded-for': '192.0.2.99, 198.51.100.7' }), 1), '198.51.100.7');
  assert.equal(clientIpFromRequest(request('10.0.0.8', { 'x-forwarded-for': 'spoofed, 198.51.100.7' }), 1), '10.0.0.8');
  assert.equal(clientIpFromRequest(request('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.7' }), 0), '127.0.0.1');
});

test('per-client room quota is released after lobby cleanup', () => {
  assert.equal(createRoom('socket-a', 'A', '198.51.100.9', 0).ok, true);
  assert.equal(createRoom('socket-b', 'B', '198.51.100.9', 10).ok, true);
  assert.deepEqual(createRoom('socket-c', 'C', '198.51.100.9', 20), { ok: false, error: 'client_room_quota' });

  const expired = cleanupExpiredLobbies(2_000, { inactivityMs: 1_000, lifetimeMs: 10_000 });
  assert.equal(expired.length, 2);
  assert.equal(roomStore.size, 0);
  assert.equal(createRoom('socket-c', 'C', '198.51.100.9', 2_001).ok, true);
});

test('lobby activity extends inactivity cleanup but not the absolute lifetime', () => {
  const room = createRoom('host', 'Host', '198.51.100.1', 0).room;
  assert.equal(joinRoom(room.code, 'guest', 'Guest', '198.51.100.2', 900).ok, true);
  assert.deepEqual(cleanupExpiredLobbies(1_500, { inactivityMs: 1_000, lifetimeMs: 10_000 }), []);
  assert.equal(roomStore.has(room.code), true);

  const expired = cleanupExpiredLobbies(10_001, { inactivityMs: 100_000, lifetimeMs: 10_000 });
  assert.equal(expired[0].reason, 'lobby_lifetime_expired');
  assert.equal(roomStore.has(room.code), false);
});

test('lobby cleanup never removes an active game', () => {
  const room = createRoom('host', 'Host', '198.51.100.1', 0).room;
  joinRoom(room.code, 'guest', 'Guest', '198.51.100.2', 1);
  room.status = 'started';
  assert.deepEqual(cleanupExpiredLobbies(1_000_000, { inactivityMs: 1, lifetimeMs: 1 }), []);
  assert.equal(roomStore.get(room.code), room);
});
