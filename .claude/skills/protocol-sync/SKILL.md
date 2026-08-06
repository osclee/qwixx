---
name: protocol-sync
description: Check whether packages/server/src/protocol.ts (zod, source of truth) and packages/client/src/net/protocol.ts (hand-mirrored plain types) have drifted at the field level. Run this whenever adding, removing, or renaming a field on a qwixx WebSocket message, adding a new message type, or touching either protocol.ts file — CLAUDE.md documents that these two files must be kept in sync by hand and nothing enforces it at build time. Also useful before opening or reviewing a qwixx PR that changes wire-protocol shapes, to catch the "changed one side, forgot the other" mistake before it ships. Not needed for changes that don't touch a message's field list (e.g. adding a new phase-timer constant, or editing table.ts logic without changing what's sent over the wire).
---

# Protocol sync checker

## What this catches that the existing test doesn't

`packages/server/test/protocolSync.test.ts` already runs in CI and checks
that both protocol.ts files agree on the *set of message type name
strings* (`"roll_dice"`, `"snapshot"`, etc.). Its own doc comment is
explicit that this is as far as it goes: it "says nothing about whether
the fields on a given message still match between the two." That's the gap
this skill fills — it diffs the actual field names on each message and
each shared interface between the two files.

Run it any time you're touching either `protocol.ts`, most importantly
right before you'd otherwise trust "I updated both files" from memory:

```bash
node .claude/skills/protocol-sync/scripts/check-protocol-sync.mjs
```

Output looks like:

```
Client -> Server messages (zod schema vs. ClientMessage union member):

  ✓ "add_bot"
  ✗ "submit_white"
      only in server: someNewField

Server -> Client interfaces shared by both files (11 found):

  ✓ SnapshotMessage
  ...
```

Exit code is `0` with no drift, `1` if anything mismatches (or if a file
fails to parse) — safe to drop into a pre-PR checklist or a git hook
alongside `npm run typecheck` / `npm test`, not just run by hand.

## Scope — read this before trusting a clean result

This is a structural AST diff (via the TypeScript compiler API, no actual
type-checking), not a type checker, and it only compares **top-level field
names, one level deep**:

- It matches client → server messages by their shared `type` string
  literal: each server `z.object({ type: z.literal("x"), ... })` against
  the corresponding member of the client's `ClientMessage` union.
- It matches server → client shapes by **interface name** appearing in
  both files (`SnapshotMessage`, `PublicSheet`, `PublicResult`, etc.).
  Type aliases that intentionally exist on only one side (e.g. the
  client's `Color`, `Phase`, `DiceRoll` convenience aliases, which the
  server inlines instead of naming) are correctly not flagged — this only
  compares names present in *both* files.
- It does **not** check field types (a field renamed to the same name but
  given an incompatible type on one side won't be caught), and it does
  **not** recurse into nested shapes — e.g. `submit_white`/`submit_color`'s
  `action` union (`{ kind: "cross"; color; value }` vs `{ kind: "pass" }`)
  is checked only as a field named `action` existing on both sides, not
  for what's inside it. A clean run means "no top-level field renamed,
  added, or removed on just one side" — real reassurance, but not a
  substitute for reading the diff on a nontrivial protocol change.

If you need to check something outside that scope (a type change, a
nested shape), that's still a manual read of both files, same as before
this skill existed.

## If it reports drift

Fix the file that's behind — usually the client's, since the server's zod
schema in `packages/server/src/protocol.ts` is documented as the source of
truth (CLAUDE.md, "The wire protocol is duplicated, not shared"). Rerun
the script after editing to confirm it's clean, and also rerun
`npm run test -w @quixx/server -- test/protocolSync.test.ts` (or the full
`npm test`) since a message-type-name-level change needs that test green
too.

## Advanced: pointing at other files

`--server <path>` and `--client <path>` override the default paths, in
case you're diffing a work-in-progress copy rather than the files in
place:

```bash
node .claude/skills/protocol-sync/scripts/check-protocol-sync.mjs \
  --server /tmp/protocol.ts --client packages/client/src/net/protocol.ts
```
