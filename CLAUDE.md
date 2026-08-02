# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Online multiplayer Qwixx (the dice game): a React client talking over
WebSocket to an authoritative Node/Fastify server, with a pure rule engine
shared by both sides. npm workspaces monorepo, three packages:

```
packages/
  engine/   @quixx/engine — pure, dependency-free rule engine (rows, legality, scoring, dice)
  server/   @quixx/server — Fastify + WebSocket server, room/session registry, SQLite persistence
  client/   @quixx/client — React + Vite UI
```

## Commands

Run from the repo root unless noted. Requires Node 20+.

```bash
npm install
npm run dev              # server on :3000 + Vite client on :5173 (proxies /ws, /api), parallel
npm test                 # engine + server suites (client has no test suite)
npm run build             # builds engine, then server, then client (order matters — see below)
npm run typecheck         # tsc --noEmit across all three packages
```

Single package / single test file (the `-w` flag targets one workspace):

```bash
npm run test -w @quixx/engine -- test/legal.test.ts
npm run test -w @quixx/server -- test/roll.test.ts
npm run typecheck -w @quixx/client
```

**Build order matters**: `@quixx/server` and `@quixx/client` both import
`@quixx/engine` as a real workspace dependency resolved via its built
`dist/`, not source — if you edit the engine, run
`npm run build -w @quixx/engine` (or the full `npm run build`) before the
server/client will see the change, including in `npm run dev` (Vite resolves
the engine's `dist/` too, so a stale engine build silently serves old rule
logic).

**Windows dev quirk**: `tsx watch` (used by `npm run dev -w @quixx/server`)
sometimes fails to rebind port 3000 after a file change, logging
`EADDRINUSE` instead of actually restarting — the old process is still
listening with stale code. If server changes don't seem to take effect,
check the terminal for that error and manually kill the process and rerun
`npm run dev:server`.

## Architecture

### The turn phase machine lives in `table.ts`, not the engine

`@quixx/engine` (packages/engine/src) is pure rules with zero I/O, no
concept of time, players connecting/disconnecting, or turn phases — it just
exposes primitives: `canCross`, `applyCross`, `resolveTurn`, `scoreSheet`,
`rollDice`. It's imported by both the server (authoritative mutation) and
the client (optimistic legal-move highlighting in `net/legalMoves.ts`,
which adapts the wire-format `PublicSheet` into the engine's `PlayerSheet`
shape).

All turn orchestration — phases, timers, who's allowed to act when — lives
in `packages/server/src/table.ts`'s `Table` class. The phase sequence per
turn:

```
ROLLING → WHITE → COLOR → RESOLVE → (FINISHED | back to ROLLING)
```

- **ROLLING**: waits for the active player to send `roll_dice` (or
  auto-rolls after `rollPhaseMs`, or immediately if they're disconnected —
  see `beginRoll`/`performRoll`). `roll` is `null` on the wire until this
  resolves.
- **WHITE**: any connected player may cross the white sum on their own
  sheet. Crosses are applied **immediately per-submission** (`submitWhite`
  calls `applyCross` directly), not batched until the phase closes — this
  was a deliberate bug fix; don't reintroduce batching, it makes an early
  submitter's cross invisible to everyone (including themselves) until the
  last player answers. The phase closes once every *connected* seat has
  answered (`allConnectedHaveAnswered`) or `whitePhaseMs` elapses.
- **COLOR**: only the active player acts.
- **RESOLVE**: calls the engine's `resolveTurn` (penalty check, deferred die
  removal, end-condition check), persists a snapshot, then either finishes
  or loops back to ROLLING.

Disconnects are handled proactively, not just passively via timers —
`recheckBarrierAfterDisconnect` re-evaluates the current phase's barrier
the moment a player drops, so e.g. the active player disconnecting during
ROLLING or COLOR unblocks the table immediately instead of waiting out the
full timer. `allConnectedHaveAnswered` treats zero connected players as
*not* satisfied (not vacuously true) specifically to prevent the turn loop
from cascading through empty-seat turns — this matters both when everyone
disconnects at once and when a table is rehydrated from storage (see
below).

Rule detail worth knowing: locking a row (crossing the terminal cell) sets
`row.locked` on that sheet immediately, but the die isn't removed from the
shared pool (`removedColors`) until `resolveTurn` runs at the end of the
turn — so the active player can still use a color die in the COLOR phase
of the same turn it was locked in. This is intentional (Qwixx §6), encoded
as an engine test (`apply.test.ts`), not a bug.

### The wire protocol is duplicated, not shared

`packages/server/src/protocol.ts` (zod-validated, the actual source of
truth) and `packages/client/src/net/protocol.ts` (plain TS types, manually
mirrored, no runtime validation) define the same message shapes
independently — there's no shared protocol package. **If you add or change
a message type, update both files.** The client file has a comment noting
this; there's no build-time check that they stay in sync.

### Client state: one external store, not React context

`packages/client/src/net/socket.ts`'s `GameConnection` owns the WebSocket
and is a module-level singleton (`net/useGame.ts`), consumed via
`useSyncExternalStore`. It reconnects with exponential backoff and
auto-sends `rejoin` using a session token from `localStorage` on open.
`App.tsx` routes between `Lobby` / `WaitingRoom` / `Table` purely off
`snapshot.lobbyState` — there's no client-side route state, so any
lobbyState transition (start game, game over, rematch back to LOBBY) just
works by virtue of the next snapshot changing that field.

Snapshots are trusted at face value with no staleness/ordering check — a
single WebSocket delivers messages in order, and a fresh reconnect only
ever sees messages generated after it attached, so there's no scenario
where an older snapshot can arrive after a newer one. (An earlier version
compared `turnSeq` to reject "stale" frames; that broke because a rematch
resets `turnSeq` back to 0, which isn't staleness — see git history if
tempted to re-add ordering logic here.)

### Persistence and restart semantics

SQLite (`better-sqlite3`) persists one snapshot per table, overwritten
every time a turn fully resolves (`resolveAndContinue` in `table.ts`) — the
save always lands at the same clean point: `phase === 'ROLLING'`,
`roll === null`. If the native module fails to load, the server falls back
to an in-memory-only store automatically (`store/sqlite.ts`); games just
won't survive a restart.

On boot, `TableRegistry.restoreFromStore` rehydrates any table that wasn't
finished. A restored table is deliberately left **paused**
(`awaitingFirstReconnectAfterRestore`) until the first player reconnects —
calling `beginRoll()` immediately with zero connected seats would otherwise
cascade the entire game to completion before any client ever saw it,
because every phase auto-closes when nobody's connected.

**The server must run as a single instance.** Game state lives in process
memory; there's no cross-instance coordination. Don't autoscale or put
multiple replicas behind a load balancer.

### Testing conventions

Server tests (`packages/server/test/`) spin up a real Fastify+WS server per
test (`testServer.ts`) and drive it with `TestClient` (`testClient.ts`), a
scripted raw WebSocket client. `TestClient.waitFor` treats a client's
inbound messages as a queue with a cursor — each call scans forward from
where the *previous* call on that same client left off. Two easy-to-hit
bugs this creates if you're not careful writing new tests:

- Reading phase-transition snapshots from **two different clients**
  interchangeably desyncs their cursors (one client's queue accumulates
  unconsumed messages the other client already skipped past). Pick one
  client as the canonical stream for tracking phase transitions across a
  whole test and only use the other client to send actions.
- The server sends any per-connection snapshot (e.g. on `rejoin`) *before*
  the explicit `joined` reply, not after — waiting for `joined` first will
  consume that snapshot as if it were an unrelated skipped message.

`testServer.ts`'s default `rollPhaseMs` is 50ms specifically so existing
turn-by-turn tests don't need to explicitly send `roll_dice` — the timer
just fires almost instantly. Tests that actually need to exercise the
ROLLING phase's waiting behavior (`roll.test.ts`) pass a longer value
explicitly.

**Testing multiplayer manually in one browser**: tabs on the same origin
share `localStorage`, so opening a second tab to simulate a second player
will silently auto-rejoin it as the *first* player (via the shared session
token) instead of showing the join form. `localStorage.clear()` in the
second tab before creating a fresh player also wipes the first tab's stored
token from the same shared store — reloading the first tab afterward can
rebind it to the wrong player. Driving a second "player" via a plain
`node -e` script using the global `WebSocket` (Node 22+) against
`ws://localhost:3000/ws` avoids this entirely and is what was used to
verify multiplayer behavior during development.

## Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `QUIXX_DB_PATH` | `./quixx.sqlite` | SQLite file path — point at a persistent volume in production |
| `QUIXX_CLIENT_DIST` | `../client/dist` relative to the server build | Directory of the built client served as static files |
| `QUIXX_ROLL_PHASE_MS` | `10000` | Time the active player has to roll before it auto-rolls |
| `QUIXX_WHITE_PHASE_MS` | `45000` | White-dice phase timeout before auto-pass |
| `QUIXX_COLOR_PHASE_MS` | `30000` | Color-dice phase timeout before auto-pass |

## Deployment

Dockerfile is a multi-stage build (compiles all three packages, ships a
single runtime image running the Fastify server, which also serves the
built client — one process, one port). The app is already deployed to
**Azure Container Apps** (single replica, `QUIXX_DB_PATH` on an Azure Files
mount, for the single-instance reason above). Deploys are automatic: a
GitHub Actions workflow
(`.github/workflows/qwixx-AutoDeployTrigger-...yml`) builds and pushes the
image to ACR and updates the Container App on every push to `master` — no
manual deploy steps. See `README.md` for a short summary.
