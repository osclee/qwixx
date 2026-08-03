# Improvement Ideas

A backlog of concrete, scoped improvements for the Qwixx project, gathered
from a survey of the current codebase (see `CLAUDE.md` for architecture
background). Each item has the idea, why it matters, and a lightweight
implementation plan intended as a starting brief for Claude to pick up and
build — not a full spec.

Items are grouped by theme but not strictly prioritized; pick whichever is
most useful next.

---

## 1. Gate deploys on tests, typecheck, and build

**Idea:** Add a CI step that runs `npm test`, `npm run typecheck`, and
`npm run build` on every push/PR, and make the Azure auto-deploy workflow
depend on it passing.

**Why:** `.github/workflows/qwixx-AutoDeployTrigger-*.yml` currently
triggers on every push to `master` (`paths: **`) and goes straight to
`azure/container-apps-deploy-action`. Nothing runs the existing engine +
server test suites, `tsc --noEmit`, or a full build first — a broken build
or a regression caught by an existing test could still deploy straight to
production. This is the highest-leverage, lowest-risk item on the list
since all the checks it needs already exist as npm scripts.

**Implementation plan:**
- Add a new workflow (e.g. `.github/workflows/ci.yml`) triggered on `push`
  and `pull_request` that runs `npm ci`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Make the existing `qwixx-AutoDeployTrigger-*.yml` workflow require this
  CI workflow to succeed first — either via a `workflow_run` trigger keyed
  off the CI workflow's success, or by adding the same check steps directly
  before the deploy step in that file (simpler, less indirection).
- Confirm a deliberately broken test locally reproduces the failure the
  workflow would catch, then revert it.

---

## 2. Add ESLint + Prettier

**Idea:** Introduce a shared ESLint config (TypeScript + React rules) and
Prettier, with a `lint` script per workspace and at the root, wired into
the CI workflow from item 1.

**Why:** There is currently no `.eslintrc*`/`eslint.config*`/`.prettierrc*`
anywhere in the repo and no `lint` script in any `package.json` — despite
`index.ts` and `store/sqlite.ts` already carrying
`eslint-disable-next-line no-console` comments that reference a linter
that doesn't exist. The codebase is otherwise disciplined, so a lint
config mostly locks in existing conventions rather than fighting them.

**Implementation plan:**
- Add `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks` (client
  only), and `prettier` as root devDependencies.
- Add a root `eslint.config.js` (flat config) with a base TS ruleset, plus
  a client override enabling `react-hooks` rules.
- Add a root `.prettierrc` and `lint`/`format` scripts at the root
  `package.json` (`eslint .`, `prettier --check .`).
- Run once repo-wide, fix or `// eslint-disable` any resulting violations
  file-by-file rather than blanket-disabling rules.
- Add the `lint` script to the CI workflow from item 1.

---

## 3. Catch client/server protocol drift automatically

**Idea:** Add a lightweight guard against `packages/server/src/protocol.ts`
and `packages/client/src/net/protocol.ts` silently diverging — either a
test that structurally compares the two, or (bigger lift) collapsing them
into one shared source.

**Why:** CLAUDE.md already flags this as a known trap: the server's
zod-validated protocol and the client's manually mirrored plain-TS
protocol are two independent files with no build-time check that they
stay in sync. A message-shape change on one side and not the other is a
silent runtime bug, not a compile error, since they're structurally
unrelated types.

**Implementation plan (lightweight option, recommended first step):**
- Add a script/test (e.g. `packages/server/test/protocol-sync.test.ts`)
  that imports both protocol modules' message-type name lists (e.g. the
  discriminated union's `type` literals) and asserts the sets match.
  This won't catch field-level drift but catches the common case of an
  added/renamed/removed message type on only one side.
- Note in the test's failure message that field-level shape changes still
  need manual review of both files.

**Implementation plan (bigger lift, separate follow-up):**
- Extract the zod schemas into a new `packages/protocol` workspace that
  both server and client depend on; have the client derive its plain TS
  types via `z.infer` instead of hand-mirroring them. This removes the
  duplication entirely but touches both packages' message-handling code
  and is a larger, riskier change — do the lightweight guard first.

---

## 4. Rate-limit WebSocket messages per connection

**Idea:** Add per-connection throttling on inbound WS messages (e.g. a
token bucket or simple sliding-window counter) in
`packages/server/src/ws.ts`, closing or ignoring connections that exceed
it.

**Why:** `ws.ts`'s `ws.on("message", ...)` handler has no throttling — a
misbehaving or malicious client can send unlimited `roll_dice`/
`submit_white`/etc. as fast as the socket allows, each one potentially
triggering a full table-state re-broadcast to every connected player.
Given the server is a single instance handling all tables (per the
single-instance architecture), this is a real availability risk, not just
theoretical.

**Implementation plan:**
- In `ws.ts`, add a small per-connection counter (e.g. max N messages per
  rolling 1s window) using a simple timestamp-array or token-bucket
  implementation — no new dependency needed for this scale.
- On exceeding the limit, drop the message (and optionally send a
  `rate_limited` protocol message so the client can show feedback) rather
  than immediately closing the connection, to avoid punishing normal
  double-click/latency retries.
- Add a server test that sends a burst of messages from one `TestClient`
  and asserts excess messages are ignored while the connection stays
  open.

---

## 5. Stand up a client test suite, starting with `legalMoves.ts`

**Idea:** Add Vitest + React Testing Library to `packages/client`, and
write the first tests for `net/legalMoves.ts` (the wire-format →
engine-shape adapter) and `ScoreSheet.tsx`.

**Why:** The client currently has zero tests — confirmed no `test` script,
no test framework in devDependencies, no `*.test.*` files. `legalMoves.ts`
is exactly the kind of translation-layer code (adapting `PublicSheet` wire
format into the engine's `PlayerSheet` shape) that silently breaks when
either side changes shape, and it currently has no safety net at all
despite the engine and server both being well-tested.

**Implementation plan:**
- Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
  `jsdom` as devDependencies to `packages/client`; add a `test` script and
  minimal `vitest.config.ts` (reusing the Vite config's aliases).
- Write `packages/client/src/net/legalMoves.test.ts` covering: a normal
  sheet with no locks, a sheet with a locked row (dice from that color
  should be illegal), and a sheet where the white sum has no legal moves
  in any row.
- Write one component test for `ScoreSheet.tsx` asserting that clicking a
  cell not in the legal-moves set does not fire the cross callback, and
  clicking one that is does.
- Add the client `test` script to the CI workflow from item 1.

---

## 6. Spectator mode

**Idea:** Let a client join a table as a read-only observer once all seats
are full, instead of getting a hard "Table is full" error.

**Why:** `registry.ts`'s `joinTable` only supports joining as a seated
player and rejects with `"Table is full"` otherwise — there's no path for
someone to watch a friend's game. This is a common, well-understood
feature for this genre of game and the architecture already broadcasts one
identical public snapshot to every player (no hidden info to filter), which
makes spectators structurally cheap to add.

**Implementation plan:**
- Server: in `registry.ts`, when `joinTable` finds no open seat, allow the
  connection to attach as a spectator — reuse the existing snapshot
  broadcast path but skip assigning a `playerId`/seat.
- Protocol: add a `role: "player" | "spectator"` field (or a separate
  `spectate` message type) to the join/joined messages in both
  `protocol.ts` files (see item 3 for keeping them in sync).
- Client: in `Lobby.tsx`, offer a "Watch" option when join returns
  table-full; in `Table.tsx`, hide/disable action controls
  (roll/cross/etc.) when `state.role === "spectator"`.
- Add a server test joining 5+ `TestClient`s to a table capped at 4 and
  asserting the 5th receives spectator status and read-only snapshots.

---

## 7. In-game text chat

**Idea:** Add a simple chat panel scoped to a table — free-text messages
broadcast to everyone connected, shown alongside the existing `EventLog`.

**Why:** There's no chat message type in either protocol file and no chat
UI component anywhere in the client — grepping the whole repo for "chat"
returns nothing. For a social multiplayer game played with friends, this
is a notable missing feature, and the existing `EventLog.tsx` component
and broadcast infrastructure make it cheap to bolt onto.

**Implementation plan:**
- Protocol: add a `chat_message` client→server message (text payload,
  server-side length cap) and a `chat_broadcast` server→client message
  (playerId, text, timestamp) to both `protocol.ts` files.
- Server: in `table.ts` or `ws.ts`, on receiving `chat_message`, validate
  length/non-empty and broadcast `chat_broadcast` to all connected
  sockets for that table — no persistence needed initially.
- Client: add a `ChatPanel.tsx` component (input + scrollback list),
  wire it into `Table.tsx` near `EventLog`, and extend `socket.ts`'s
  `ClientState` with a chat message list.
- Basic abuse guard: reuse the rate limiter from item 4, or add a
  simple per-connection message-per-second cap specific to chat.

---

## 8. Game history / stats page

**Idea:** Surface the finished-game results that are already persisted but
currently invisible after the `GameOver` modal closes.

**Why:** `SqliteStore` already writes `results_json` per finished table
(`packages/server/src/store/sqlite.ts`), but there's no API route or
client screen to browse it — results are visible only transiently in
`GameOver.tsx` before the lobby resets. The data model work is already
done; this is purely a read-path feature.

**Implementation plan:**
- Server: add a `GET /api/tables/:id/history` (or similar) Fastify route
  reading from `SqliteStore` and returning stored results; consider
  whether results should be keyed by a stable player identity or just
  shown per-table for now (simplest: per-table only, no cross-game player
  stats yet).
- Client: add a simple results view accessible from `GameOver.tsx`
  ("View past games" link) or a standalone route, rendering final scores
  per row/player from the stored JSON.
- Keep scope to "show what's already stored" — cross-game player stats
  (win/loss records, head-to-head) is a natural follow-up but a separate,
  larger change (needs a stable player identity model, which doesn't
  exist yet).

---

## 9. Accessibility pass on the score sheet and turn feedback

**Idea:** Add descriptive `aria-label`s to score-sheet cells and an
`aria-live` region announcing turn/roll/phase changes.

**Why:** Only 7 `aria-*`/`role` attributes exist across the entire client,
concentrated in a handful of components. `ScoreSheet.tsx`'s grid of cells
uses real `<button>` elements (good — keyboard-reachable by default) but
each cell has no label describing what crossing it means, so a screen
reader only announces the bare number. There's also no live region, so
phase transitions and dice rolls (announced visually via `useJustRevealed`
and `Timer`) are invisible to non-visual users.

**Implementation plan:**
- In `ScoreSheet.tsx`, add `aria-label={`Cross ${value} in ${color} row`}`
  (or similar) to each cell button, and `aria-pressed`/`aria-disabled` to
  reflect crossed/illegal state.
- Add a visually-hidden `aria-live="polite"` region (e.g. in `Table.tsx`
  or `TurnBar.tsx`) that updates with short text on phase change ("Your
  turn to roll", "White dice: cross or pass", etc.) — reuse the existing
  phase value from the snapshot as the trigger.
- Add `Escape`-to-close on `GameOver.tsx`'s modal (currently only closes
  on backdrop click).
- Spot-check with a screen reader (VoiceOver/NVDA) or the browser's
  accessibility tree inspector on one full turn cycle.

---

## 10. Structured logging via Fastify's pino instance

**Idea:** Replace ad-hoc `console.error`/`console.warn` calls with the
Fastify app's existing `logger: true` pino instance, consistently.

**Why:** `app.ts` already enables Fastify's built-in pino logger, but
`index.ts` and `store/sqlite.ts` use raw `console.error`/`console.warn`
instead (each with a `eslint-disable-next-line no-console` comment
pointing at a linter that doesn't exist yet — see item 2). This means
app-level errors and SQLite fallback warnings bypass structured logging
entirely, making them harder to filter/aggregate in production if a log
pipeline is ever added.

**Implementation plan:**
- Thread the Fastify instance's `.log` (or a shared logger created at
  bootstrap) into `index.ts` and `store/sqlite.ts` in place of the
  `console.*` calls.
- Where `store/sqlite.ts` doesn't have easy access to the Fastify
  instance (e.g. it's constructed before the app), consider exporting a
  small shared `pino` logger instance from a new `logger.ts` used by both
  bootstrap code and the store, rather than threading the Fastify
  instance through.
- Remove the now-unnecessary `eslint-disable-next-line no-console`
  comments once item 2's lint config is in place (or add `no-console` as
  an enforced rule at that point so this doesn't regress).

---

## 11. Persistent, dismissible error toasts

**Idea:** Render `lastError`/`errorSeq` from `ClientState` as a
dismissible toast/banner instead of (or in addition to) however they
currently surface, so connection/protocol errors are clearly visible.

**Why:** `socket.ts`'s `ClientState` already tracks `lastError` and an
`errorSeq` counter (suggesting errors are meant to be re-shown even if the
same message repeats), but it wasn't clear from a codebase pass where —
or whether — this renders persistently versus flashing briefly. Given
there's no toast/snackbar system anywhere in the client, it's worth
confirming this is actually visible to players today, since a swallowed
or easy-to-miss error (e.g. a rejected illegal move, a dropped connection)
is a poor experience in a real-time multiplayer game.

**Implementation plan:**
- First, trace where `lastError`/`errorSeq` are currently consumed (grep
  `App.tsx` and children) to confirm whether this is a real gap or
  already handled adequately — don't build a toast system speculatively.
- If it is a gap: add a small `Toast.tsx` component keyed by `errorSeq`
  (so repeated identical errors still re-trigger the animation), mounted
  once near the root of `App.tsx`, auto-dismissing after a few seconds
  with a manual close button.
- Keep it to one active toast at a time initially — a full queueing
  system is over-engineering for a single-error-field data model.

---

## Not included

A few ideas were considered and deliberately left out of this list:

- **Rule variants / alternate boards** — the engine hardcodes the
  standard Qwixx board (`packages/engine/src/rows.ts`) by design, and
  generalizing it touches scoring, legality, and both protocols. Worth
  revisiting only if there's real demand, since it's a much bigger,
  more invasive change than anything above.
- **Extracting a fully shared protocol package** — listed as the "bigger
  lift" option under item 3 rather than its own item, since the
  lightweight sync-check is the better first move.
