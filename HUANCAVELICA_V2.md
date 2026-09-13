# Huancavelica Simulator v2 backend

Huancavelica v2 is the bitmap-authoritative terrain preset `huancavelica-v2`. Its strict network contract is terrain revision `huancavelica-v2-bitmap-1` plus collision model `bitmap-terrain-mask-v2`.

## Terrain and transform

The server loads `assets/huancavelica-v2-terrain-mask.bin`, a compact row-major bit mask matching the frontend's cleaned 1448×1086 PNG mask. The authored image maps uniformly to a 5000×3750 world with scale `5000 / 1448`. There is no independent-axis stretching and the old approximately 31-platform Huancavelica graph does not control v2 physics.

The supplied Mask was treated as semantic guidance, but its large alignment/noise differences from the final supplied Terrain made it unsafe as the physical source. The production mask was therefore rebuilt from the final Terrain alpha, cleaned to exclude antialias debris and non-supporting vines, and audited as 19 connected authored island masses. The Terrain PNG remains the approved visible production art.

## Authoritative behavior

The same mutable bit mask controls:

- spawn and pickup grounding on playable upper boundaries;
- 15-unit grounded walking and slope tolerance;
- free velocity-based jumps, steerable airborne motion, ledge drops, and support-loss falls;
- projectile contact through segmented/swept ballistic sampling;
- muzzle correction when a spawn point is embedded in terrain;
- circular crater removal and deterministic replay for current and late-joining clients.

Each room starts from the clean bit mask and replays its ordered world-space crater list. The v2 jump never searches for a landing before takeoff. `jump_player` with an empty payload applies a 650-unit/s upward impulse; `air_move` sends only horizontal input `-1`, `0`, or `1`. The authoritative `player.airborne` state contains `vx`, `vy`, `input`, `startedAt`, `updatedAt`, and `reason`; current position remains `player.spawn`. The 20 Hz server simulation broadcasts airborne snapshots at up to 10 Hz and uses gravity 1050 units/s², air acceleration 1500 units/s², max horizontal speed 320 units/s, exponential drag 1.35/s, and terminal fall speed 1100 units/s. Movement is subdivided to at most 1/120 second and spatially swept in at most 2-world-unit increments against head, body side, and feet probes. Landing requires a playable upper boundary and support across the vehicle width. A side or underside contact cancels the blocked velocity rather than snapping onto a platform.

Walking off an edge and losing support to a crater enter the same airborne state at the current position with zero initial downward velocity. Falling continues without input packets; the player may steer while their turn remains active. Void death occurs only after the body passes 80 world units below the 3750-unit world bottom. While airborne, fire and aim/power changes are rejected; normal turn-based firing resumes on landing. Weapon ballistics, damage, turns, wind, and inventory remain on their existing paths.

## Compatibility and fallback

Public room state includes the v2 revision, collision model, image/world dimensions, and `platforms: []`. The frontend refuses an incompatible v2 backend rather than guessing. Phase 11 removes legacy `huancavelica` from public `terrainPresets` and rejects new direct selection, while retaining `phase10-huancavelica.js` for existing-room recovery and regression testing. Random selection and random rematches use only the existing base terrain IDs, so neither can revive v1. Other terrain presets retain their existing collision paths.

## Verification and deployment

`npm run check` covers mask queries, stacked surfaces, side/underside collision, 2/4/8-player spawns, grounded movement, free takeoff, air steering, turn locks, swept high-speed landing, ledges, support loss, void timing, projectile sweep, crater replay, and regressions for v1 and other maps.

Repository CI validates source and tests only. It does not deploy or prove parity with the currently running Google Cloud Run revision; Cloud Run deployment remains a separate required operation after merge.
