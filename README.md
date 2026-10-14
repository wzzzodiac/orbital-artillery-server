# Carabayllo Secret Wars Server

Authoritative multiplayer backend for **Carabayllo Secret Wars**.

Repository name intentionally remains `wzzzodiac/orbital-artillery-server`; the frontend repository is `wzzzodiac/carabayllo-secret-wars`.

## Current status

**v0.9.8 Release Candidate / Phase 9 mechanical baseline.**

Current architecture:

- Node.js
- Socket.IO/WebSockets
- Google Cloud Run
- `min instances = 0`
- intended `max instances = 1`
- in-memory private rooms
- no accounts
- no database
- 2–8 temporary players per room
- authoritative turns, movement, projectiles, damage, pickups, AFK voting, stats and rematch state

### Huancavelica Simulator authority

Huancavelica v2 uses `phase11-huancavelica-v2.js` and a compact cleaned 1448×1086 bit mask as the sole physical terrain authority. Grounding, movement, jumps, spawns, pickups, projectile impacts, support loss, and crater replay all query that mutable mask; the old platform graph does not control v2. Only v2 appears in the public Huancavelica map pool; v1 remains in Phase 10 solely for legacy-room recovery and regressions. Other maps retain their existing collision systems. See [HUANCAVELICA_V2.md](HUANCAVELICA_V2.md) for the complete revision and deployment contract.

## Local start

```bash
npm ci
npm start
```

Health check:

```text
GET /health
```

## Current gameplay notes

- pickup contact includes a 74-unit vehicle/pickup touch threshold
- jump/fall traversal performs swept pickup-hitbox checks so airborne grazing can collect a box
- AFK F1 eligibility starts only after 20 continuous seconds without valid activity from the active player; new activity resets the inactivity window and clears votes
- Cluster child blasts and Air Strike shells apply independent radial damage
- Nuke visual timing remains 5 seconds warning + 5 seconds active beam

## Deployment note

### Session 01: v2 combat and player-state ownership

Huancavelica v2 BASIC and Heavy now resolve through `huancavelica-v2-combat.js`:
final projectile contact -> balanced damage/Shield -> bitmap cut -> bitmap
knockback/support -> definitive survival -> result -> telemetry. This path never
runs the legacy heightfield damage/support pass or resurrects a player afterward.
It reuses the existing 10/20 damage balance and combat-motion coefficients.
Results are recomputed from survivors when the attack finishes; no pending result
remains after finalization. Other weapons and other maps keep their existing
resolution paths; the audit's Cluster/Air Strike/Nuke findings are not fixed here.

`huancavelica-v2-state.js` assigns authored spawns only from `startRoom`, including
legitimate rematches. Neither participant count nor a public-state read can spawn
players. The composed v2 public serializer decorates a detached read-only view;
legacy pickup maintenance/RNG is disabled for that view. Authoritative maintenance
continues on mutation/tick paths. Legacy map implementations remain available.

Regression command: `node --test test/composed-v2-combat.test.js`. These tests import
the same composed exports as `server.js`, covering the authored 45/55/wind0 shot,
Team/Survival winners and simultaneous KO, Shield, bitmap void death, disconnect,
rematch and serialization purity. Full gate: `npm ci --ignore-scripts` followed by
`npm run check`.

Local play (PowerShell): set `$env:PORT='3000'` and
`$env:CLIENT_ORIGINS='http://127.0.0.1:4173'`, then run `npm start` here. In the
unchanged frontend checkout, run `python -m http.server 4173 --bind 127.0.0.1`.
Open `http://127.0.0.1:4173` in two browser tabs; create/join, select v2, ready and
start. A third participant can be used to verify disconnect without ending the
two survivors' match. No production deployment is required.

GitHub CI validates repository code/tests but does not itself prove that Google Cloud Run currently serves the exact latest backend commit. Runtime deployment parity is checked separately when needed.

### Session 02: definitive v2 weapon contacts

`huancavelica-v2-combat.js` also owns Triple, Cluster, Air Strike and Nuke
resolution on v2; legacy maps retain their existing resolvers. The small
`huancavelica-v2-weapons.js` module creates `projectile.impacts`. Every contact
has an `id`, `attackId`, `weaponType`, `ownerPlayerId`, `parentProjectileId`,
`x/y`, `contactType`, `targetPlayerId`, `impactAt`, `damageRule`, `terrainCuts`,
`damageResults` and an explicit `resolved` flag. Pending flights are forecasts;
after every cut, unresolved flights are recomputed chronologically against the
current bitmap and live players. Resolved contacts never move or replay.

Cluster launches five real arcs from the final parent, with the existing
-180/-90/0/90/180 spread, 667ms delay and 167ms stagger. Its 1333ms nominal
return arc may contact side walls sooner or lower islands later. Air Strike
retains seven shells, 4s nominal fall and 233ms stagger. Their transmitted
flight coefficients drive the matching frontend presentation. Cuts and feed
events carry the impact ID; no nearest-X crater association is used.

Nuke rebuilds both diagonal endpoints around its definitive designator and
retains 5s warning, 5s beam, 1.5s buffer, damage20, half-width115, radius118 scars
and depth330 compatibility metadata. Scars are spaced at 45 units (half the
old 90-unit surface-only step) to cover the complete beam width through bitmap
rock. No heightfield surface lookup or knockback is used for this beam.

Shield covers one complete attack with cumulative half-damage rounding, not
one independently rounded/consumed Shield per child. Each impact records final
damage/death telemetry before the next impact; results wait for the sequence
and support animation, then recompute final survivors. Explosion collection
remains disabled under the existing Phase9 rules; Nuke still destroys pickups.

Run `node --test test/composed-v2-weapons.test.js` for the Session02 composed
regressions, or `npm ci --ignore-scripts` then `npm run check` for the full gate.
The first test commit intentionally fails CSW-04/05/06 on Session01 main.
Serve the matching frontend review branch on port4173 using the local commands
above. Local QA preload fixtures are not production endpoints or shipped code.

### Request admission and proxy trust

- `CLIENT_ORIGINS` is a comma-separated list of exact browser origins. The production default is `https://wzzzodiac.github.io`; add an exact local-development origin when serving the frontend locally.
- `ALLOW_MISSING_ORIGIN=true` keeps command-line and other non-browser clients compatible. Browser requests with an Origin header must match `CLIENT_ORIGINS`.
- `TRUST_PROXY_HOPS=0` is the safe default and ignores `X-Forwarded-For`. If the deployed Cloud Run ingress or an external load balancer has a confirmed, fixed proxy chain, set this to the number of trusted hops nearest the server. The selected client address is counted from the right of the validated IP chain, so client-supplied values before the trusted chain cannot override it.
- Confirm the production proxy topology before changing `TRUST_PROXY_HOPS`; repository source alone does not establish whether traffic reaches Cloud Run directly or through an additional external load balancer.

### Lobby abuse controls

Each trusted client identity may own at most `MAX_ACTIVE_ROOMS_PER_CLIENT` unfinished rooms. Lobby-only cleanup removes rooms after `LOBBY_INACTIVITY_MINUTES` without a meaningful lobby action and enforces `MAX_LOBBY_LIFETIME_MINUTES` as an absolute cap. Countdown, active, and finished games are excluded from this cleanup.
