#!/usr/bin/env node
/**
 * Drives a fake "second player" against a running qwixx dev server over a
 * plain WebSocket — see CLAUDE.md's "Testing multiplayer manually in one
 * browser" note for why this exists: two browser tabs on the same origin
 * share localStorage, so a second tab silently rejoins as the *first*
 * player instead of showing the join form. This script sidesteps that
 * entirely by not being a browser tab.
 *
 * Each invocation is a short-lived WebSocket connection: connect, send one
 * or two protocol messages, print whatever comes back for a bit, then
 * disconnect. That matches how the app already treats real players anyway
 * (see table.ts's disconnect/reconnect handling) — a "player" here is just
 * a session token persisted to disk between runs, resumed via `rejoin` on
 * every command after the first.
 *
 * Requires Node's global WebSocket (stable since Node 22 — see CLAUDE.md).
 *
 * Usage:
 *   node second-player.mjs create <nickname> [--daily]
 *   node second-player.mjs join <roomCode> <nickname>
 *   node second-player.mjs status
 *   node second-player.mjs start
 *   node second-player.mjs roll
 *   node second-player.mjs white cross <color> <value>
 *   node second-player.mjs white pass
 *   node second-player.mjs color cross <w1|w2> <color> <value>
 *   node second-player.mjs color pass
 *   node second-player.mjs addbot <easy|medium|hard>
 *   node second-player.mjs removebot <playerId>
 *   node second-player.mjs chat <words...>
 *   node second-player.mjs newgame
 *   node second-player.mjs leave
 *   node second-player.mjs end
 *   node second-player.mjs raw '<json message>'
 *
 * Flags (any command):
 *   --as <identity>     Which saved session to use/create. Default: player2.
 *                        Use different identities to drive several fake
 *                        players (player2, player3, ...) at once.
 *   --url <ws url>      Default: ws://localhost:3000/ws (or $QWIXX_WS_URL).
 *   --listen-ms <n>     How long to keep listening after sending. Default: 900.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "..", ".sessions");

const HELP = `Usage:
  node second-player.mjs create <nickname> [--daily]
  node second-player.mjs join <roomCode> <nickname>
  node second-player.mjs status
  node second-player.mjs start
  node second-player.mjs roll
  node second-player.mjs white cross <color> <value>
  node second-player.mjs white pass
  node second-player.mjs color cross <w1|w2> <color> <value>
  node second-player.mjs color pass
  node second-player.mjs addbot <easy|medium|hard>
  node second-player.mjs removebot <playerId>
  node second-player.mjs chat <words...>
  node second-player.mjs newgame
  node second-player.mjs leave
  node second-player.mjs end
  node second-player.mjs raw '<json message>'

Flags (any command):
  --as <identity>   Which saved session to use/create. Default: player2.
  --url <ws url>    Default: ws://localhost:3000/ws (or $QUIXX_WS_URL).
  --listen-ms <n>   How long to keep listening after sending. Default: 900.`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = {
    as: "player2",
    url: process.env.QUIXX_WS_URL ?? "ws://localhost:3000/ws",
    listenMs: 900,
    daily: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--as") flags.as = argv[++i];
    else if (a === "--url") flags.url = argv[++i];
    else if (a === "--listen-ms") flags.listenMs = Number(argv[++i]);
    else if (a === "--daily") flags.daily = true;
    else positionals.push(a);
  }
  return { flags, positionals };
}

function sessionPath(identity) {
  return path.join(SESSION_DIR, `${identity}.json`);
}

function loadSession(identity) {
  const p = sessionPath(identity);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveSession(identity, data) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(sessionPath(identity), JSON.stringify(data, null, 2));
}

function requireSession(identity) {
  const s = loadSession(identity);
  if (!s) {
    fail(
      `no saved session for "${identity}" — run "create <nickname>" or ` +
        `"join <roomCode> <nickname>" first (add --as ${identity} if this ` +
        `isn't the default identity)`,
    );
  }
  return s;
}

/** Builds the message for commands that need an existing session (everything but create/join). */
function buildActionMessage(command, positionals) {
  switch (command) {
    case "status":
      return null; // rejoin alone is enough to get a fresh snapshot
    case "start":
      return { type: "start_game" };
    case "roll":
      return { type: "roll_dice" };
    case "newgame":
      return { type: "new_game" };
    case "leave":
      return { type: "leave_table" };
    case "end":
      return { type: "end_game" };
    case "addbot": {
      const [difficulty] = positionals;
      if (!["easy", "medium", "hard"].includes(difficulty))
        fail(
          `addbot needs a difficulty: easy | medium | hard (got "${difficulty}")`,
        );
      return { type: "add_bot", difficulty };
    }
    case "removebot": {
      const [playerId] = positionals;
      if (!playerId)
        fail(
          "removebot needs a playerId (see the snapshot's sheets[].playerId)",
        );
      return { type: "remove_bot", playerId };
    }
    case "white": {
      const [kind] = positionals;
      if (kind === "pass")
        return { type: "submit_white", action: { kind: "pass" } };
      if (kind === "cross") {
        const [, color, value] = positionals;
        if (!color || value === undefined)
          fail("white cross needs <color> <value>");
        return {
          type: "submit_white",
          action: { kind: "cross", color, value: Number(value) },
        };
      }
      fail(`white needs "cross <color> <value>" or "pass" (got "${kind}")`);
      break;
    }
    case "color": {
      const [kind] = positionals;
      if (kind === "pass")
        return { type: "submit_color", action: { kind: "pass" } };
      if (kind === "cross") {
        const [, whiteDie, color, value] = positionals;
        if (!whiteDie || !color || value === undefined)
          fail("color cross needs <w1|w2> <color> <value>");
        return {
          type: "submit_color",
          action: { kind: "cross", whiteDie, color, value: Number(value) },
        };
      }
      fail(
        `color needs "cross <w1|w2> <color> <value>" or "pass" (got "${kind}")`,
      );
      break;
    }
    case "chat": {
      const text = positionals.join(" ");
      if (!text) fail("chat needs some words to say");
      return { type: "chat_message", text };
    }
    case "raw": {
      const [json] = positionals;
      if (!json)
        fail('raw needs a JSON string, e.g. raw \'{"type":"roll_dice"}\'');
      try {
        return JSON.parse(json);
      } catch {
        fail(`raw argument isn't valid JSON: ${json}`);
      }
      break;
    }
    default:
      fail(
        `unknown command "${command}" — see the header comment for the full list`,
      );
  }
}

function main() {
  if (typeof WebSocket === "undefined") {
    fail(
      "no global WebSocket in this Node runtime — this script needs Node 22+ " +
        "(same requirement CLAUDE.md notes for the manual multiplayer-testing trick).",
    );
  }

  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  const { flags, positionals } = parseArgs(rest);
  const { as: identity, url, listenMs } = flags;

  let initialMessage;
  let followUpMessage = null;

  if (command === "create") {
    const [nickname] = positionals;
    if (!nickname) fail("create needs a nickname, e.g. create Bob");
    initialMessage = {
      type: flags.daily ? "create_daily_table" : "create_table",
      nickname,
    };
  } else if (command === "join") {
    const [roomCode, nickname] = positionals;
    if (!roomCode || !nickname)
      fail("join needs a room code and a nickname, e.g. join ABCD Bob");
    initialMessage = { type: "join_table", roomCode, nickname };
  } else {
    const session = requireSession(identity);
    initialMessage = { type: "rejoin", sessionToken: session.sessionToken };
    followUpMessage = buildActionMessage(command, positionals);
  }

  const startedAt = Date.now();
  const log = (direction, msg) => {
    const elapsed = String(Date.now() - startedAt).padStart(5, " ");
    console.log(`[+${elapsed}ms] ${direction} ${JSON.stringify(msg, null, 2)}`);
  };

  const ws = new WebSocket(url);

  const openTimeout = setTimeout(() => {
    fail(
      `timed out connecting to ${url} — is the dev server running? (npm run dev / npm run dev:server)`,
    );
  }, 5000);

  ws.addEventListener("open", () => {
    clearTimeout(openTimeout);
    log("->", initialMessage);
    ws.send(JSON.stringify(initialMessage));
    if (followUpMessage) {
      log("->", followUpMessage);
      ws.send(JSON.stringify(followUpMessage));
    }
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data.toString());
    log("<-", msg);
    if (msg.type === "joined") {
      saveSession(identity, {
        sessionToken: msg.sessionToken,
        roomCode: msg.roomCode,
        playerId: msg.playerId,
        url,
        as: identity,
        savedAt: new Date().toISOString(),
      });
      console.log(
        `(session saved for "${identity}" — room ${msg.roomCode}, playerId ${msg.playerId})`,
      );
    }
  });

  ws.addEventListener("error", (event) => {
    clearTimeout(openTimeout);
    fail(`WebSocket error connecting to ${url}: ${event.message ?? event}`);
  });

  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, listenMs + 200);
}

main();
