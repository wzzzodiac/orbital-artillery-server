import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function reservePort() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function startServer(t, extraEnv = {}) {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit'); child.kill(); await exit;
    }
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) assert.fail(logs);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { port, logs: () => logs };
    } catch {}
    await delay(30);
  }
  assert.fail(`Server did not start:\n${logs}`);
}

function websocketStatus(port, { origin, forwardedFor } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let response = '';
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('WebSocket handshake timed out')); }, 3_000);
    socket.on('connect', () => {
      const headers = [
        'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13'
      ];
      if (origin !== undefined) headers.push(`Origin: ${origin}`);
      if (forwardedFor !== undefined) headers.push(`X-Forwarded-For: ${forwardedFor}`);
      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
    });
    socket.on('data', chunk => {
      response += chunk.toString('latin1');
      if (!response.includes('\r\n\r\n')) return;
      clearTimeout(timeout);
      const status = Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1]);
      socket.destroy();
      resolve(status);
    });
    socket.on('error', error => { clearTimeout(timeout); reject(error); });
  });
}

test('WebSocket admission accepts configured and missing origins, and rejects foreign origins', { timeout: 20_000 }, async t => {
  const server = await startServer(t, {
    CLIENT_ORIGINS: 'https://wzzzodiac.github.io,http://127.0.0.1:4173',
    ALLOW_MISSING_ORIGIN: 'true',
    CONNECTION_ATTEMPTS_PER_MINUTE: '20'
  });
  assert.equal(await websocketStatus(server.port, { origin: 'https://wzzzodiac.github.io' }), 101, server.logs());
  assert.equal(await websocketStatus(server.port, { origin: 'http://127.0.0.1:4173' }), 101, server.logs());
  assert.equal(await websocketStatus(server.port, { origin: 'https://evil.example' }), 400, server.logs());
  assert.equal(await websocketStatus(server.port), 101, server.logs());
});

test('spoofed X-Forwarded-For values do not bypass the direct-client limiter', { timeout: 20_000 }, async t => {
  const server = await startServer(t, {
    CLIENT_ORIGINS: 'https://wzzzodiac.github.io',
    TRUST_PROXY_HOPS: '0',
    CONNECTION_ATTEMPTS_PER_MINUTE: '2'
  });
  assert.equal(await websocketStatus(server.port, { origin: 'https://wzzzodiac.github.io', forwardedFor: '198.51.100.1' }), 101, server.logs());
  assert.equal(await websocketStatus(server.port, { origin: 'https://wzzzodiac.github.io', forwardedFor: '198.51.100.2' }), 101, server.logs());
  assert.equal(await websocketStatus(server.port, { origin: 'https://wzzzodiac.github.io', forwardedFor: '198.51.100.3' }), 400, server.logs());
});
