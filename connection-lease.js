// Includes Engine.IO transports that never open a Socket.IO namespace.
export function armJoinDeadline(transport, isAdmitted, { delayMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const timer = setTimer(() => { if (!isAdmitted()) transport.close(); }, delayMs);
  timer.unref?.();
  transport.once('close', () => clearTimer(timer));
}
