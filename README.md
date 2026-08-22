# Orbital Artillery Server

Authoritative multiplayer backend scaffold for Orbital Artillery.

## Current status

**Phase 0 — scaffold only.** The process can boot and expose a health endpoint, but room/gameplay events are intentionally not implemented yet.

Target architecture:

- Node.js
- Socket.IO/WebSockets
- Google Cloud Run
- `min instances = 0`
- initially `max instances = 1`
- in-memory rooms for the MVP
- no accounts
- no database
- 2–8 temporary players per private room

The browser client lives in the separate `orbital-artillery` repository.

## Local start

```bash
npm install
npm start
```

Health check:

```text
GET /health
```

## First implementation milestone

Implement private room creation/joining, temporary player names, host assignment, ready state and disconnect cleanup. The target test is eight browser tabs/devices connected to the same room before any artillery gameplay is added.

## Cost constraint

The MVP is designed around a zero-euro target while usage remains inside free tiers. Cloud Run deployment settings and billing alerts must be configured manually before public multiplayer testing.
