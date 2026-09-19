import { isIP } from 'node:net';

function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  const normalized = unwrapped.startsWith('::ffff:') && isIP(unwrapped.slice(7)) === 4 ? unwrapped.slice(7) : unwrapped;
  return isIP(normalized) ? normalized : null;
}

function forwardedIps(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const values = header.split(',').map(normalizeIp);
  return values.length && values.every(Boolean) ? values : null;
}

export function clientIpFromRequest(req, trustedProxyHops = 0) {
  const remoteAddress = normalizeIp(req?.socket?.remoteAddress) || 'unknown';
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return remoteAddress;

  const forwarded = forwardedIps(req?.headers?.['x-forwarded-for']);
  if (!forwarded) return remoteAddress;

  const chain = [...forwarded, remoteAddress];
  const clientIndex = chain.length - 1 - trustedProxyHops;
  return clientIndex >= 0 ? chain[clientIndex] : remoteAddress;
}

export function isOriginAllowed(req, allowedOrigins, allowMissingOrigin) {
  const value = req?.headers?.origin;
  if (value === undefined) return allowMissingOrigin;
  if (typeof value !== 'string') return false;

  let origin;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) return false;
    origin = url.origin;
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}

export const requestSecurityTestHooks = Object.freeze({ normalizeIp, forwardedIps });
