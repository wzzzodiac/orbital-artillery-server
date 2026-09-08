# Huancavelica runtime checklist

Manual QA after deployment:

1. Start a fresh Huancavelica match after the new backend revision is live.
2. During the active player's turn, hold A/D across continuous grass and confirm the vehicle follows the visible surface.
3. Drive off a ledge and confirm the vehicle falls to the next visible island or into the void.
4. Jump with Space near platform edges and confirm the arc clears visible rock and lands on visible authored terrain.
5. Change angle with W/S and power with Q/E, then fire with F while active.
6. Confirm the projectile follows the displayed angle/power and collides with the first visible terrain pixel on its ballistic path.
7. Create craters and repeat movement/jump/fire over damaged terrain.
8. Confirm a spectator sees WAIT and cannot fire during another player's turn.
