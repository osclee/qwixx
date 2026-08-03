import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { tryCreateSqliteStore } from "../src/store/sqlite.js";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { SnapshotMessage } from "../src/protocol.js";

describe("CPU bots", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("lets the host add and remove an easy bot, and rejects non-hosts", async () => {
    const server = await startTestServer({ seed: 1 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({
      type: "join_table",
      roomCode: aliceJoined.roomCode,
      nickname: "Bob",
    });
    await bob.waitForType("joined");
    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    // Non-host cannot add or remove bots.
    bob.send({ type: "add_bot", difficulty: "easy" });
    const addErr = await bob.waitForType("error");
    expect(addErr.code).toBe("add_bot_failed");

    alice.send({ type: "add_bot", difficulty: "easy" });
    const withBot = await alice.waitForSnapshot((s) => s.sheets.length === 3);
    const botSeat = withBot.sheets.find((s) => s.isBot);
    expect(botSeat).toBeTruthy();
    expect(botSeat!.nickname).toBe("CPU 1 (Easy)");
    expect(botSeat!.connected).toBe(true);

    bob.send({ type: "remove_bot", playerId: botSeat!.playerId });
    const removeErr = await bob.waitForType("error");
    expect(removeErr.code).toBe("remove_bot_failed");

    alice.send({ type: "remove_bot", playerId: botSeat!.playerId });
    const withoutBot = await alice.waitForSnapshot(
      (s) => s.sheets.length === 2,
    );
    expect(withoutBot.sheets.some((s) => s.isBot)).toBe(false);
  });

  it("plays an entire single-player game (host + 1 bot) to completion without any action from the bot's own client", async () => {
    const server = await startTestServer({ seed: 42, botRandom: () => 0 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    alice.send({ type: "add_bot", difficulty: "easy" });
    const lobbySnap = await alice.waitForSnapshot((s) => s.sheets.length === 2);
    const botPlayerId = lobbySnap.sheets.find((s) => s.isBot)!.playerId;

    alice.send({ type: "start_game" });
    const firstWhite = await alice.waitForSnapshot((s) => s.phase === "WHITE");

    const finalSnap = await runToFinish(
      alice,
      aliceJoined.playerId,
      firstWhite,
    );

    expect(finalSnap.lobbyState).toBe("FINISHED");
    expect(finalSnap.phase).toBe("FINISHED");
    expect(finalSnap.results).toHaveLength(2);
    expect(finalSnap.results!.some((r) => r.playerId === botPlayerId)).toBe(
      true,
    );
  });

  it("plays an entire single-player game with a medium bot to completion", async () => {
    const server = await startTestServer({ seed: 7, botRandom: () => 0 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    alice.send({ type: "add_bot", difficulty: "medium" });
    const lobbySnap = await alice.waitForSnapshot((s) => s.sheets.length === 2);
    const botSeat = lobbySnap.sheets.find((s) => s.isBot);
    expect(botSeat!.nickname).toBe("CPU 1 (Medium)");

    alice.send({ type: "start_game" });
    const firstWhite = await alice.waitForSnapshot((s) => s.phase === "WHITE");

    const finalSnap = await runToFinish(
      alice,
      aliceJoined.playerId,
      firstWhite,
    );

    expect(finalSnap.lobbyState).toBe("FINISHED");
    expect(
      finalSnap.results!.some((r) => r.playerId === botSeat!.playerId),
    ).toBe(true);
  });

  it("plays an entire single-player game with a hard bot to completion, including voluntary passes", async () => {
    const server = await startTestServer({ seed: 11, botRandom: () => 0 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    alice.send({ type: "add_bot", difficulty: "hard" });
    const lobbySnap = await alice.waitForSnapshot((s) => s.sheets.length === 2);
    const botSeat = lobbySnap.sheets.find((s) => s.isBot);
    expect(botSeat!.nickname).toBe("CPU 1 (Hard)");

    alice.send({ type: "start_game" });
    const firstWhite = await alice.waitForSnapshot((s) => s.phase === "WHITE");

    const finalSnap = await runToFinish(
      alice,
      aliceJoined.playerId,
      firstWhite,
    );

    expect(finalSnap.lobbyState).toBe("FINISHED");
    expect(
      finalSnap.results!.some((r) => r.playerId === botSeat!.playerId),
    ).toBe(true);
  });

  it("lets a bot answer the WHITE phase on its own without blocking on the human, and still waits for the human", async () => {
    const server = await startTestServer({ seed: 3, botRandom: () => 0 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");
    alice.send({ type: "add_bot", difficulty: "easy" });
    const lobbySnap = await alice.waitForSnapshot((s) => s.sheets.length === 2);
    const botPlayerId = lobbySnap.sheets.find((s) => s.isBot)!.playerId;

    alice.send({ type: "start_game" });
    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");

    // The bot should answer on its own (near-instant test delay) while the
    // phase is still open, waiting on Alice.
    const botAnswered = await alice.waitForSnapshot(
      (s) => s.phase === "WHITE" && s.whiteSubmitted.includes(botPlayerId),
    );
    expect(botAnswered.whiteSubmitted).not.toContain(aliceJoined.playerId);

    alice.send({ type: "submit_white", action: { kind: "pass" } });
    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");
    expect(colorSnap.turnSeq).toBe(whiteSnap.turnSeq);
  });

  describe("restart durability", () => {
    let dbPath: string | null = null;

    afterEach(() => {
      if (dbPath) {
        for (const suffix of ["", "-wal", "-shm"]) {
          try {
            fs.rmSync(dbPath + suffix);
          } catch {
            // fine if it never existed
          }
        }
      }
      dbPath = null;
    });

    it("restores a bot seat as connected after a restart, and it keeps playing once the human reconnects", async () => {
      dbPath = path.join(os.tmpdir(), `quixx-bot-test-${randomUUID()}.sqlite`);

      const store1 = await tryCreateSqliteStore(dbPath);
      expect(store1).not.toBeNull();

      const server1 = await startTestServer({
        seed: 5,
        store: store1!,
        botRandom: () => 0,
      });
      close = server1.close;

      const alice = await TestClient.connect(server1.url);
      alice.send({ type: "create_table", nickname: "Alice" });
      const aliceJoined = await alice.waitForType("joined");
      alice.send({ type: "add_bot", difficulty: "easy" });
      const lobbySnap = await alice.waitForSnapshot(
        (s) => s.sheets.length === 2,
      );
      const botPlayerId = lobbySnap.sheets.find((s) => s.isBot)!.playerId;

      alice.send({ type: "start_game" });
      const firstWhite = await alice.waitForSnapshot(
        (s) => s.phase === "WHITE",
      );

      // Play turn 1 out completely so resolveAndContinue persists a
      // snapshot with turnSeq=1.
      await playOneTurn(alice, aliceJoined.playerId, firstWhite);
      // Wait until the bot has also answered turn 2's white phase (not just
      // entered it) so no bot "thinking" timer is still in flight when we
      // yank the server out from under it below.
      const whiteSnap2 = await alice.waitForSnapshot(
        (s) => s.phase === "WHITE" && s.whiteSubmitted.includes(botPlayerId),
      );
      expect(whiteSnap2.turnSeq).toBe(1);

      // "The server restarts."
      await server1.close();
      close = null;

      const store2 = await tryCreateSqliteStore(dbPath);
      const server2 = await startTestServer({
        seed: 999,
        store: store2!,
        botRandom: () => 0,
      });
      close = server2.close;

      const rejoined = await TestClient.connect(server2.url);
      rejoined.send({ type: "rejoin", sessionToken: aliceJoined.sessionToken });
      const restoredSnap = await rejoined.waitForType("snapshot");
      await rejoined.waitForType("joined");

      expect(restoredSnap.lobbyState).toBe("IN_PROGRESS");
      const botSheet = restoredSnap.sheets.find(
        (s) => s.playerId === botPlayerId,
      );
      expect(botSheet!.isBot).toBe(true);
      expect(botSheet!.connected).toBe(true); // no socket ever attaches for a bot — must not be left "gone"

      // The turn loop should keep progressing after the human reconnects,
      // proving the bot keeps participating (not just marked connected).
      const whiteSnap3 = await rejoined.waitForSnapshot(
        (s) => s.phase === "WHITE",
        5000,
      );
      await playOneTurn(rejoined, aliceJoined.playerId, whiteSnap3);
      const whiteSnap4 = await rejoined.waitForSnapshot(
        (s) => s.phase === "WHITE",
        5000,
      );
      expect(whiteSnap4.turnSeq).toBeGreaterThan(whiteSnap3.turnSeq);
    });
  });
});

/**
 * Passes every WHITE/COLOR decision on Alice's behalf (never sending
 * anything for the bot seat) for exactly one turn, landing back on the next
 * WHITE (or FINISHED) snapshot.
 *
 * COLOR always gets its own broadcast now (table.ts's enterColorPhase
 * broadcasts a snapshot even when nobody has a legal color move, before
 * immediately closing the phase), but this still waits for "COLOR, or the
 * NEXT turn's WHITE (turnSeq advanced), or FINISHED" as a defensive
 * fallback rather than assuming COLOR always shows up.
 */
async function playOneTurn(
  alice: TestClient,
  alicePlayerId: string,
  whiteSnap: SnapshotMessage,
): Promise<SnapshotMessage> {
  if (whiteSnap.phase === "FINISHED") return whiteSnap;
  const turnSeq = whiteSnap.turnSeq;
  alice.send({ type: "submit_white", action: { kind: "pass" } });

  const next = (await alice.waitFor(
    (m) =>
      m.type === "snapshot" &&
      (m.phase === "FINISHED" ||
        m.phase === "COLOR" ||
        (m.phase === "WHITE" && m.turnSeq > turnSeq)),
  )) as SnapshotMessage;
  if (next.phase !== "COLOR") return next; // FINISHED, or COLOR had nothing to do and was skipped entirely

  if (next.activePlayerId === alicePlayerId) {
    alice.send({ type: "submit_color", action: { kind: "pass" } });
  }
  // Otherwise the bot is active and resolves color on its own.

  return (await alice.waitFor(
    (m) =>
      m.type === "snapshot" && (m.phase === "WHITE" || m.phase === "FINISHED"),
  )) as SnapshotMessage;
}

/**
 * Drives an entire single-player (1 human + bots) game to completion,
 * passing on Alice's behalf every turn and never sending anything for any
 * bot seat — proving the bot scheduling logic alone is enough to reach
 * FINISHED.
 */
async function runToFinish(
  alice: TestClient,
  alicePlayerId: string,
  firstWhiteSnapshot: SnapshotMessage,
): Promise<SnapshotMessage> {
  let whiteSnap = firstWhiteSnapshot;
  for (let turn = 0; turn < 80; turn++) {
    if (whiteSnap.phase === "FINISHED") return whiteSnap;
    whiteSnap = await playOneTurn(alice, alicePlayerId, whiteSnap);
  }
  throw new Error("Game did not finish within 80 turns");
}
