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

Huancavelica v2 uses `phase11-huancavelica-v2.js` and a compact cleaned 1448×1086 bit mask as the sole physical terrain authority. Grounding, movement, jumps, spawns, pickups, projectile impacts, support loss, and crater replay all query that mutable mask; the old platform graph does not control v2. Huancavelica v1 remains available through its Phase 10 path and other maps retain their existing collision systems. See [HUANCAVELICA_V2.md](HUANCAVELICA_V2.md) for the complete revision and deployment contract.

## Local start

```bash
npm install
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
