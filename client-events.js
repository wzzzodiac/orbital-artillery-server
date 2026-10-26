import {validAnimal,validCart} from './appearance.js';

const text = max => value => typeof value === 'string' && value.length <= max;
const number = value => typeof value === 'number' && Number.isFinite(value);
const boolean = value => typeof value === 'boolean';
const direction = value => number(value) && [-1, 0, 1].includes(value);

// Only fields used by the protocol may reach a game handler.
const schemas = {
  create_room: { required: { name: text(256) }, optional: {animal:validAnimal,cart:validCart} },
  join_room: { required: { name: text(256), code: text(32) }, optional: {animal:validAnimal,cart:validCart} },
  set_appearance: { required: {animal:validAnimal,cart:validCart} },
  set_mode: { required: { mode: text(32) } },
  set_terrain: { required: { terrain: text(64) } },
  set_ready: { required: { ready: boolean } },
  set_team: { required: { team: text(8) } },
  start_game: {},
  return_to_lobby: {},
  leave_party: {},
  rematch_game: { optional: { randomMap: boolean } },
  move_player: { required: { direction } },
  air_input: { required: { direction } },
  jump_player: { optional: { direction } },
  set_aim: { optional: { angle: number, power: number } },
  select_item: { required: { slot: value => Number.isInteger(value) && value >= 1 && value <= 3 } },
  fire_projectile: {},
  toggle_afk_skip_vote: {}
};

export function isValidClientPayload(event, payload) {
  if (!Object.hasOwn(schemas, event)) return false;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const { required = {}, optional = {} } = schemas[event];
  for (const [key, validate] of Object.entries(required)) {
    if (!Object.hasOwn(payload, key) || !validate(payload[key])) return false;
  }
  for (const key of Object.keys(payload)) {
    if (Object.hasOwn(required, key)) continue;
    if (!Object.hasOwn(optional, key) || !optional[key](payload[key])) return false;
  }
  return true;
}

export function onClientEvent(socket, event, handler, { onAccepted = () => {} } = {}) {
  if (!Object.hasOwn(schemas, event)) throw new Error('Unknown client event schema');
  socket.on(event, async (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    let replied = false;
    const reply = result => {
      if (replied) return false;
      replied = true;
      if (result?.ok) onAccepted();
      if (!ack) return false;
      // A failed acknowledgement must not escape the event boundary.
      try { ack(result); return true; } catch { return false; }
    };
    try {
      const payload = args.length === 0 ? {} : args[0];
      if (args.length > 1 || !isValidClientPayload(event, payload)) {
        reply({ ok: false, error: 'invalid_payload' });
        return;
      }
      await handler(payload, reply);
    } catch {
      // Do not echo payloads, stack traces or internal errors to the client.
      console.error(`Client event failed: ${event}`);
      reply({ ok: false, error: 'internal_error' });
    }
  });
}

// ACK callers already receive the state. Fire-and-forget callers still need the broadcast.
export function replyRoomState(socket, io, roomCode, state, reply, extra = {}) {
  const acknowledged = reply({ ok: true, room: state, ...extra });
  (acknowledged ? socket.to(roomCode) : io.to(roomCode)).emit('room_state', state);
}
