function parsePort(value) {
  const port = Number(value ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export const CONFIG = Object.freeze({
  port: parsePort(process.env.PORT),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5500',
  maxPlayers: 8
});
