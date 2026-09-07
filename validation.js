const ROOM_CODE_PATTERN = /^[A-Z0-9]{4}$/;

export function normalizePlayerName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 20) : '';
}

export function isValidRoomCode(value) {
  return typeof value === 'string' && ROOM_CODE_PATTERN.test(value.toUpperCase());
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
