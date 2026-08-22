const ROOM_CODE_PATTERN = /^[A-Z0-9]{4}$/;

export function normalizePlayerName(value) {
  return String(value ?? '').trim().slice(0, 20);
}

export function isValidRoomCode(value) {
  return ROOM_CODE_PATTERN.test(String(value ?? '').toUpperCase());
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
