import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

test('real Socket.IO transport survives malformed events and enforces map authority', { timeout: 20000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit'); child.kill(); await exit;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  const fetchText = async (path, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' },
      body, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, logs);
    return response.text();
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) assert.fail(logs);
    try { await fetchText('/health'); ready = true; break; } catch { await delay(30); }
  }
  assert.ok(ready, logs);
  const connect = async () => {
    const path = '/socket.io/?EIO=4&transport=polling';
    const open = await fetchText(path);
    const sid = JSON.parse(open.slice(1)).sid;
    const endpoint = `${path}&sid=${encodeURIComponent(sid)}`;
    await fetchText(endpoint, '40');
    assert.ok((await fetchText(endpoint)).startsWith('40'));
    let ackId = 0;
    return {
      async raw(args) { await fetchText(endpoint, '42' + JSON.stringify(args)); },
      async request(event, payload, ...extra) {
        const id = ++ackId;
        await fetchText(endpoint, `42${id}` + JSON.stringify([event, payload, ...extra]));
        for (let i = 0; i < 10; i++) {
          const packets = (await fetchText(endpoint)).split('\x1e');
          const ack = packets.find(packet => packet.startsWith(`43${id}[`));
          if (ack) return JSON.parse(ack.slice(2 + String(id).length))[0];
        }
        assert.fail('Missing acknowledgement');
      }
    };
  };
  const host = await connect();
  await host.raw(['set_mode', { mode: 'team' }, null]);
  await host.raw(['create_room', { name: { toString: null } }]);
  for (const [event, payload, extra] of [
    ['create_room', { name: { toString: null } }], ['create_room', null],
    ['set_mode', { mode: 'team' }, null], ['set_ready', { ready: 'false' }],
    ['set_aim', { angle: { toString: null } }]
  ]) {
    const result = extra === undefined ? await host.request(event, payload) : await host.request(event, payload, extra);
    assert.deepEqual(result, { ok: false, error: 'invalid_payload' });
  }
  const created = await host.request('create_room', { name: 'Host' });
  assert.equal(created.ok, true);
  const guest = await connect();
  assert.equal((await guest.request('join_room', { name: 'Guest', code: created.room.code })).ok, true);
  assert.equal((await host.request('set_terrain', { terrain: 'huancavelica' })).ok, true);
  assert.equal((await guest.request('set_terrain', { terrain: 'rolling' })).error, 'host_only');
  const state = await host.request('set_ready', { ready: true });
  assert.equal(state.room.terrainPreset, 'huancavelica');
  assert.equal((await host.request('set_terrain', { terrain: 'islands' })).room.terrainPreset, 'islands');
  assert.equal(JSON.parse(await fetchText('/health')).ok, true);
  assert.equal(child.exitCode, null);
});
