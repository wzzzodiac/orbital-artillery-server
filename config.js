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

function parseNonNegativeInt(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseBoolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false.`);
}

function parseOrigins(value) {
  const raw = value || process.env.CLIENT_ORIGIN || 'https://wzzzodiac.github.io';
  const origins = raw.split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    let url;
    try { url = new URL(entry); } catch { throw new Error(`Invalid CLIENT_ORIGINS entry: ${entry}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry) {
      throw new Error(`CLIENT_ORIGINS entries must be exact http(s) origins: ${entry}`);
    }
    return url.origin;
  });
  if (!origins.length) throw new Error('CLIENT_ORIGINS must contain at least one origin.');
  return Object.freeze([...new Set(origins)]);
}

export const CONFIG = Object.freeze({
  port: parsePort(process.env.PORT),
  allowedOrigins: parseOrigins(process.env.CLIENT_ORIGINS),
  allowMissingOrigin: parseBoolean(process.env.ALLOW_MISSING_ORIGIN, true, 'ALLOW_MISSING_ORIGIN'),
  trustedProxyHops: parseNonNegativeInt(process.env.TRUST_PROXY_HOPS, 0, 'TRUST_PROXY_HOPS'),
  maxPlayers: 8,
  maxRooms: parsePositiveInt(process.env.MAX_ROOMS, 20, 'MAX_ROOMS'),
  maxActiveRoomsPerClient: parsePositiveInt(process.env.MAX_ACTIVE_ROOMS_PER_CLIENT, 2, 'MAX_ACTIVE_ROOMS_PER_CLIENT'),
  lobbyInactivityMinutes: parsePositiveInt(process.env.LOBBY_INACTIVITY_MINUTES, 15, 'LOBBY_INACTIVITY_MINUTES'),
  maxLobbyLifetimeMinutes: parsePositiveInt(process.env.MAX_LOBBY_LIFETIME_MINUTES, 60, 'MAX_LOBBY_LIFETIME_MINUTES'),
  maxConcurrentSockets: parsePositiveInt(process.env.MAX_CONCURRENT_SOCKETS, 64, 'MAX_CONCURRENT_SOCKETS'),
  connectionAttemptsPerMinute: parsePositiveInt(process.env.CONNECTION_ATTEMPTS_PER_MINUTE, 20, 'CONNECTION_ATTEMPTS_PER_MINUTE'),
  packetsPerSecond: parsePositiveInt(process.env.PACKETS_PER_SECOND, 30, 'PACKETS_PER_SECOND'),
  idleSocketMinutes: parsePositiveInt(process.env.IDLE_SOCKET_MINUTES, 30, 'IDLE_SOCKET_MINUTES')
});
