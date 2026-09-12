# Huancavelica Simulator v2 backend

Huancavelica v2 is the bitmap-authoritative terrain preset `huancavelica-v2`. Its strict network contract is terrain revision `huancavelica-v2-bitmap-1` plus collision model `bitmap-terrain-mask-v2`.

## Terrain and transform

The server loads `assets/huancavelica-v2-terrain-mask.bin`, a compact row-major bit mask matching the frontend's cleaned 1448×1086 PNG mask. The authored image maps uniformly to a 5000×3750 world with scale `5000 / 1448`. There is no independent-axis stretching and the old approximately 31-platform Huancavelica graph does not control v2 physics.

The supplied Mask was treated as semantic guidance, but its large alignment/noise differences from the final supplied Terrain made it unsafe as the physical source. The production mask was therefore rebuilt from the final Terrain alpha, cleaned to exclude antialias debris and non-supporting vines, and audited as 19 connected authored island masses. The Terrain PNG remains the approved visible production art.

## Authoritative behavior

The same mutable bit mask controls:

- spawn and pickup grounding on playable upper boundaries;
- 15-unit walking, slope tolerance, natural drops, and support loss;
- 180-unit normal jumps and adaptive extensions up to 420 units with swept path rejection;
- projectile contact through segmented/swept ballistic sampling;
- muzzle correction when a spawn point is embedded in terrain;
- circular crater removal and deterministic replay for current and late-joining clients.

Each room starts from the clean bit mask and replays its ordered world-space crater list. If destruction removes support, a surviving tank falls to the next real bitmap surface or into the void. Weapon damage, turns, wind, aim, power, and inventory continue through the existing authoritative systems.

## Compatibility and fallback

Public room state includes the v2 revision, collision model, image/world dimensions, and `platforms: []`. The frontend refuses an incompatible v2 backend rather than guessing. Huancavelica v1 continues through `phase10-huancavelica.js`, while other terrain presets retain their existing collision paths.

## Verification and deployment

`npm run check` covers mask queries, stacked surfaces, side/underside rejection, 2/4/8-player spawns, movement, stepping routes, spectator denial, projectile sweep, crater replay, support loss, and regressions for v1 and other maps.

Repository CI validates source and tests only. It does not deploy or prove parity with the currently running Google Cloud Run revision; Cloud Run deployment remains a separate required operation after merge.
