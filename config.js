function parsePort(value) {
  const port = Number(value ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parsePositiveInt(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export const CONFIG = Object.freeze({
  port: parsePort(process.env.PORT),
  clientOrigin: process.env.CLIENT_ORIGIN || 'https://wzzzodiac.github.io',
  maxPlayers: 8,
  maxRooms: parsePositiveInt(process.env.MAX_ROOMS, 20, 'MAX_ROOMS'),
  maxConcurrentSockets: parsePositiveInt(process.env.MAX_CONCURRENT_SOCKETS, 64, 'MAX_CONCURRENT_SOCKETS'),
  connectionAttemptsPerMinute: parsePositiveInt(process.env.CONNECTION_ATTEMPTS_PER_MINUTE, 20, 'CONNECTION_ATTEMPTS_PER_MINUTE'),
  packetsPerSecond: parsePositiveInt(process.env.PACKETS_PER_SECOND, 30, 'PACKETS_PER_SECOND'),
  idleSocketMinutes: parsePositiveInt(process.env.IDLE_SOCKET_MINUTES, 30, 'IDLE_SOCKET_MINUTES')
});
