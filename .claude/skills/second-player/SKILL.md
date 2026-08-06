---
name: second-player
description: Drive a fake second (or third, fourth...) qwixx player against the local dev server from the command line, for manually testing multiplayer flows — joining a table, rolling, crossing white/color cells, adding bots, chatting, finishing a game — without needing a second real browser. Use this whenever testing or verifying a qwixx multiplayer change by hand, whenever the user asks to "test with two players" or "simulate another player," or whenever opening a second browser tab would be tempting — that tab silently rejoins as the first player instead (shared localStorage), which is exactly the trap this skill avoids. Only applies to this qwixx repo's local dev server (ws://localhost:3000/ws by default), not to the Daily Challenge (single-player, no second seat) or local pass-and-play (no server involved).
---

# Second player (manual multiplayer testing)

## Why this exists

Qwixx's client stores its session token in `localStorage`, and browser tabs
on the same origin share that store. Opening a second tab to play-test as
"player two" doesn't show a join form — it silently reconnects the tab as
player one, and clearing `localStorage` to fix that wipes out the first
tab's token too. CLAUDE.md documents the workaround: drive a second player
with a plain WebSocket script instead of a browser tab. This skill packages
that script so it doesn't need to be re-derived by hand each time.

## Prerequisites

- The dev server must already be running (`npm run dev` or
  `npm run dev:server` from the repo root) — this talks to it directly at
  `ws://localhost:3000/ws`, bypassing the Vite client entirely.
- Needs Node 22+ for the global `WebSocket` (the repo's own minimum is Node
  20, but this specific trick needs 22 — same caveat CLAUDE.md calls out).

## How it works

Every invocation of `scripts/second-player.mjs` is a short-lived WebSocket
connection: it sends one command's worth of protocol messages, prints
whatever the server sends back for under a second, then disconnects. It
doesn't try to stay connected between commands — instead, the first
`create`/`join` saves a session token to `.sessions/<identity>.json`
(gitignored), and every later command opens a fresh connection and leads
with `rejoin` using that saved token. This isn't a workaround; it's exactly
how the real app already treats a disconnecting/reconnecting player (see
`table.ts` in CLAUDE.md's disconnect-handling notes), so the table sees a
completely ordinary reconnect each time, not anything exotic.

Run everything from the repo root:

```bash
# Player one is normally a real browser tab at localhost:5173 that creates
# a table and notes the room code shown in the waiting room. Then bring in
# a second player from the terminal:
node .claude/skills/second-player/scripts/second-player.mjs join ABCD Bob

# From here on, --as defaults to "player2" and reuses the saved session:
node .claude/skills/second-player/scripts/second-player.mjs status
node .claude/skills/second-player/scripts/second-player.mjs start
node .claude/skills/second-player/scripts/second-player.mjs roll
node .claude/skills/second-player/scripts/second-player.mjs white cross red 7
node .claude/skills/second-player/scripts/second-player.mjs color cross w1 blue 9
node .claude/skills/second-player/scripts/second-player.mjs chat "gg"
```

To drive more than two players, give each one its own `--as` identity:

```bash
node .claude/skills/second-player/scripts/second-player.mjs join ABCD Carol --as player3
node .claude/skills/second-player/scripts/second-player.mjs roll --as player3
```

Testing the Daily Challenge or a fresh table end-to-end doesn't need a
`join` at all — `create [nickname] [--daily]` starts a brand new table as
that identity, which is also a fast way to smoke-test table creation
without touching the browser at all.

Every command prints the raw protocol messages sent and received
(pretty-printed JSON with an elapsed-time prefix), so this doubles as a way
to eyeball the exact wire shape of a `snapshot`, `error`, or `event`
message during debugging — not just a way to click buttons remotely.

## Command reference

Run `node .claude/skills/second-player/scripts/second-player.mjs --help`
for the full list, or read the header comment in
`scripts/second-player.mjs`. Every legal client message has a shorthand
command except a couple of rarely-needed ones — for anything not covered
(or a deliberately malformed message, e.g. to test the server's error
handling), use `raw '<json>'` with any message shape from
`packages/server/src/protocol.ts`.

## Notes

- `--listen-ms <n>` (default 900) controls how long the script keeps the
  socket open after sending, in case a slow response (e.g. an auto-roll
  timer) needs more time to arrive — bump it if output seems to cut off
  before the interesting message shows up.
- Session files live in `.sessions/` next to the script and are
  gitignored — safe to delete anytime to force a fresh `create`/`join`.
- If `status` (or any action) fails with "no saved session," the identity
  either never ran `create`/`join`, or its session file was deleted.
