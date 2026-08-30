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

`phase10-huancavelica.js` owns the production Alpine Ridge platform graph, traversal links, spawns and projectile/platform intersection. Destruction remains authoritative: every crater is normalized with an impact height and `phase10PlatformId`, so a blast deforms only the island it actually hit even when several platforms overlap at the same world X coordinate. Public clients receive the unchanged base platform silhouettes plus crater data and reconstruct the same visible destructible surface.

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

