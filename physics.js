export function simulateProjectile({ x, y, angleRadians, power, gravity = 9.81, wind = 0, dt = 1 / 60, maxSeconds = 12 }) {
  const points = [];
  let px = x;
  let py = y;
  let vx = Math.cos(angleRadians) * power;
  let vy = -Math.sin(angleRadians) * power;
  const steps = Math.ceil(maxSeconds / dt);

  for (let i = 0; i < steps; i += 1) {
    vx += wind * dt;
    vy += gravity * dt;
    px += vx * dt;
    py += vy * dt;
    points.push({ x: px, y: py });
  }

  return points;
}
