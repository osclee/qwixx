# Qwixx

Online multiplayer Qwixx: a browser client (React) talking over WebSocket to
an authoritative Node/Fastify server, with a shared rule engine used by both
sides.

Inspired by https://gamewright.com/product/Qwixx!

## Features

- **Online multiplayer** — create or join a table by code, 2-5 players per
  table, in-game chat, live connection status.
- **Bot players** (easy/medium/hard difficulty) can fill empty seats in an
  online table — see `packages/server/src/bot.ts` for the move-ranking
  logic behind each difficulty.
- **Daily Challenge** — a single-player game against a "hard" bot, using
  dice rolls seeded deterministically from the UTC date so every player
  gets the same rolls that day (`packages/server/src/daily.ts`), with a
  Wordle-style shareable result and local score history.
- **Local multiplayer (pass & play)** — a full game driven entirely in the
  browser with no server involved, for playing on one shared device
  (`packages/client/src/local/localGame.ts`).

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
npm test             # engine + server + client test suites
npm run typecheck    # tsc --noEmit across all three packages
npm run build         # builds engine, server, and client
npm run lint          # eslint across the repo
npm run format:check  # prettier --check
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
- The server pings every WebSocket connection on an interval (native
  ping/pong plus an app-level `ping` message) to detect dead peers and
  drive the client's connection-status indicator — see
  `packages/server/src/ws.ts`.
- Inbound WebSocket messages are token-bucket rate-limited per connection
  (`packages/server/src/rateLimiter.ts`).

See `CLAUDE.md` for a deeper tour of the turn-phase state machine, wire
protocol, and other architectural details worth knowing before making
non-trivial changes.

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

## Contributing

- Read `CLAUDE.md` first — it documents non-obvious invariants (turn-phase
  ordering, the duplicated wire protocol, disconnect handling) that are easy
  to break without realizing it.
- Remember the build order: `@quixx/server` and `@quixx/client` resolve
  `@quixx/engine` via its built `dist/`, not source. Run
  `npm run build -w @quixx/engine` (or a full `npm run build`) after
  editing the engine before the change is visible elsewhere, including
  under `npm run dev`.
- If you add or change a WebSocket message type, update both
  `packages/server/src/protocol.ts` (zod schemas, source of truth) and
  `packages/client/src/net/protocol.ts` (mirrored plain types) — nothing
  enforces they stay in sync.
- Before opening a PR, make sure `npm run typecheck`, `npm test`, and
  `npm run lint` all pass — the same three checks (plus a full build) run
  in CI (`.github/workflows/ci.yml`) on every push and pull request.
- Prefer adding a test in the relevant package's `test/` (engine, server)
  or alongside the component/module (client, colocated `*.test.ts(x)`)
  over manual verification alone.

## Deployment

The app is deployed and running on **Azure Container Apps** (single
replica, stateful — see above). Every push to `master` triggers
[`.github/workflows/qwixx-AutoDeployTrigger-...yml`](.github/workflows/),
which builds the Docker image and pushes a new revision automatically — no
manual deploy steps needed.
