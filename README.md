# Qwixx

Online multiplayer Qwixx: a browser client (React) talking over WebSocket to
an authoritative Node/Fastify server, with a shared rule engine used by both
sides. Supports bot players (easy/medium/hard) for filling empty seats.

```
packages/
  engine/   @quixx/engine — pure, dependency-free rule engine (rows, legality, scoring, dice)
  server/   @quixx/server — Fastify + WebSocket server, room/session registry, SQLite persistence
  client/   @quixx/client — React + Vite UI
```

## Local development

Requires Node 20+.

```bash
npm install
npm run dev
```

This starts the Fastify server on `:3000` and the Vite dev server on
`:5173` (which proxies `/ws` and `/api` to `:3000`). Open
`http://localhost:5173`.

```bash
npm test        # engine + server test suites
npm run build    # builds engine, server, and client
```

## Architecture notes

- **Game state is authoritative on the server and lives in process
  memory.** Every piece of Qwixx state is public (no hidden information), so
  the server broadcasts one identical snapshot to every player — there's no
  per-player state to reconcile.
- **This means the server must run as a single instance.** There is no
  cross-instance state sharing. Do not autoscale or run multiple replicas
  behind a load balancer without sticky, single-instance routing — a second
  instance would have no idea any tables exist.
- SQLite (`better-sqlite3`) persists a snapshot of each table once per
  completed turn, so an in-progress game survives a process restart. If the
  native module fails to load, the server automatically falls back to an
  in-memory-only store (games won't survive a restart, but the server still
  starts) — see `packages/server/src/store/sqlite.ts`.

### Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `QUIXX_DB_PATH` | `./quixx.sqlite` | SQLite file path — point this at a persistent volume in production |
| `QUIXX_CLIENT_DIST` | `../client/dist` relative to the server build | Directory of the built client to serve as static files |
| `QUIXX_ROLL_PHASE_MS` | `10000` | Time the active player has to roll before it auto-rolls |
| `QUIXX_WHITE_PHASE_MS` | `45000` | White-dice phase timeout before auto-pass |
| `QUIXX_COLOR_PHASE_MS` | `30000` | Color-dice phase timeout before auto-pass |

## Docker

```bash
docker build -t quixx .
docker run -p 3000:3000 -v quixx-data:/data quixx
```

The image is a multi-stage build: it compiles all three packages, then ships
a single runtime image that runs the Fastify server, which also serves the
built client's static files — one process, one port, no separate frontend
host needed. The container writes its SQLite file to `/data`; mount a
volume there for persistence across restarts.

## Deployment

The app is deployed and running on **Azure Container Apps** (single
replica, stateful — see above). Every push to `master` triggers
[`.github/workflows/qwixx-AutoDeployTrigger-...yml`](.github/workflows/),
which builds the Docker image and pushes a new revision automatically — no
manual deploy steps needed.
