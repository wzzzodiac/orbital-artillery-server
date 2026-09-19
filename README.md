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

GitHub CI validates repository code/tests but does not itself prove that Google Cloud Run currently serves the exact latest backend commit. Runtime deployment parity is checked separately when needed.

### Request admission and proxy trust

- `CLIENT_ORIGINS` is a comma-separated list of exact browser origins. The production default is `https://wzzzodiac.github.io`; add an exact local-development origin when serving the frontend locally.
- `ALLOW_MISSING_ORIGIN=true` keeps command-line and other non-browser clients compatible. Browser requests with an Origin header must match `CLIENT_ORIGINS`.
- `TRUST_PROXY_HOPS=0` is the safe default and ignores `X-Forwarded-For`. If the deployed Cloud Run ingress or an external load balancer has a confirmed, fixed proxy chain, set this to the number of trusted hops nearest the server. The selected client address is counted from the right of the validated IP chain, so client-supplied values before the trusted chain cannot override it.
- Confirm the production proxy topology before changing `TRUST_PROXY_HOPS`; repository source alone does not establish whether traffic reaches Cloud Run directly or through an additional external load balancer.

### Lobby abuse controls

Each trusted client identity may own at most `MAX_ACTIVE_ROOMS_PER_CLIENT` unfinished rooms. Lobby-only cleanup removes rooms after `LOBBY_INACTIVITY_MINUTES` without a meaningful lobby action and enforces `MAX_LOBBY_LIFETIME_MINUTES` as an absolute cap. Countdown, active, and finished games are excluded from this cleanup.
