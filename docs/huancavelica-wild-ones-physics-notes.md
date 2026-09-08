# Huancavelica bitmap physics notes

Huancavelica uses an authored foreground/terrain bitmap plus a bit-packed collision mask derived from the same terrain alpha. The platform rectangles remain only as spawn/navigation metadata.

Runtime rules for this map:

- A/D movement samples top-facing transitions in the authored mask at 15 world-unit steps.
- Walkable surface changes retain the existing 42-unit tolerance.
- Walking off a ledge falls to the next authored surface below, or into the void if there is none.
- Jump endpoints are selected from real bitmap surfaces rather than platform-link IDs.
- Jump arcs are sampled against the bitmap and may raise the apex only when clearance requires it, capped by the existing 1050-unit adaptive envelope.
- Projectile angle, power, velocity, gravity and wind remain unchanged; only the first terrain impact is corrected against the authored collision mask.
- Craters replay into the same mask, so later movement and projectile queries use destroyed terrain.

This follows the same core separation seen in preserved Wild Ones map code: authored foreground art is separate from the collision mask, collision is queried from bitmap pixels, and explosions remove terrain from the mask/foreground at matching coordinates.
