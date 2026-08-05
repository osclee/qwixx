import { afterEach, describe, expect, it } from "vitest";
import { Table } from "../src/table.js";
import { MemoryStore } from "../src/store/memory.js";
import { buildDailyRollSchedule, dailyDateKey, dailySeed } from "../src/daily.js";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { SnapshotMessage } from "../src/protocol.js";
import type { FullDiceRoll } from "@quixx/engine";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Daily Challenge", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("seats the bot first (its structural advantage) and marks the table as daily", async () => {
    const server = await startTestServer({ botMoveDelayMs: { min: 0, max: 5 } });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_daily_table", nickname: "Alice" });
    const joined = await alice.waitForType("joined");

    const snap = await alice.waitForSnapshot((s) => s.sheets.length === 2);
    expect(snap.lobbyState).toBe("IN_PROGRESS");
    expect(snap.sheets.some((s) => s.isBot)).toBe(true);
    expect(snap.sheets.find((s) => !s.isBot)!.playerId).toBe(joined.playerId);

    // Bot goes first: the very first active player is the bot, not the human.
    const firstWhite = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const botPlayerId = firstWhite.sheets.find((s) => s.isBot)!.playerId;
    expect(firstWhite.activePlayerId).toBe(botPlayerId);

    expect(snap.daily).not.toBeNull();
    expect(snap.daily!.dateKey).toBe(dailyDateKey());
    expect(snap.daily!.result).toBeNull();
  });

  it("gives every player the same day's roll schedule", async () => {
    const server = await startTestServer({ botMoveDelayMs: { min: 0, max: 5 } });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_daily_table", nickname: "Alice" });
    await alice.waitForType("joined");
    const aliceFirstWhite = await alice.waitForSnapshot(
      (s) => s.phase === "WHITE",
    );

    const bob = await TestClient.connect(server.url);
    bob.send({ type: "create_daily_table", nickname: "Bob" });
    await bob.waitForType("joined");
    const bobFirstWhite = await bob.waitForSnapshot((s) => s.phase === "WHITE");

    // Two independent daily tables created moments apart on the same UTC
    // day must deal the exact same first roll — that's the whole point of
    // "preset rolls", not just "seeded" ones.
    expect(bobFirstWhite.roll).toEqual(aliceFirstWhite.roll);
  });

  it("has no daily status on a normal (non-daily) table", async () => {
    const server = await startTestServer();
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    // Per testClient.ts / CLAUDE.md: the per-connection snapshot arrives
    // *before* the "joined" reply, so wait for the snapshot first or
    // `waitForType("joined")` would silently skip past it.
    const snap = await alice.waitForSnapshot();
    expect(snap.daily).toBeNull();
  });

  it("records a loss when the player never scores", async () => {
    const server = await startTestServer({ botMoveDelayMs: { min: 0, max: 5 } });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_daily_table", nickname: "Alice" });
    const joined = await alice.waitForType("joined");
    const firstWhite = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const botPlayerId = firstWhite.sheets.find((s) => s.isBot)!.playerId;

    // Alice always passes, on every white and color decision she's offered
    // — guaranteeing she never scores a single point, so the bot (which
    // does play, and takes a 5-point penalty at worst) always ends up
    // ahead. This mirrors bots.test.ts's runToFinish/playOneTurn pattern.
    let whiteSnap = firstWhite;
    let expectedHumanTurns = 0;
    for (let turn = 0; turn < 80 && whiteSnap.phase !== "FINISHED"; turn++) {
      const turnSeq = whiteSnap.turnSeq;
      if (whiteSnap.activePlayerId === joined.playerId) expectedHumanTurns++;
      alice.send({ type: "submit_white", action: { kind: "pass" } });
      const next = (await alice.waitFor(
        (m) =>
          m.type === "snapshot" &&
          (m.phase === "FINISHED" ||
            m.phase === "COLOR" ||
            (m.phase === "WHITE" && m.turnSeq > turnSeq)),
      )) as SnapshotMessage;
      if (next.phase === "COLOR") {
        if (next.activePlayerId === joined.playerId) {
          alice.send({ type: "submit_color", action: { kind: "pass" } });
        }
        whiteSnap = (await alice.waitFor(
          (m) =>
            m.type === "snapshot" &&
            (m.phase === "WHITE" || m.phase === "FINISHED"),
        )) as SnapshotMessage;
      } else {
        whiteSnap = next;
      }
    }

    expect(whiteSnap.lobbyState).toBe("FINISHED");
    expect(whiteSnap.daily).not.toBeNull();
    expect(whiteSnap.daily!.result).not.toBeNull();
    expect(whiteSnap.daily!.result!.won).toBe(false);
    expect(whiteSnap.daily!.result!.playerTurns).toBe(expectedHumanTurns);

    const aliceSheet = whiteSnap.sheets.find((s) => s.playerId === joined.playerId)!;
    const totalScore = (["red", "yellow", "green", "blue"] as const).reduce(
      (sum, c) => sum + aliceSheet.rows[c].score,
      0,
    );
    expect(totalScore).toBe(0); // never crossed anything
    expect(whiteSnap.results!.find((r) => r.playerId === botPlayerId)!.rank).toBe(1);
  });

  it("computeDailyStatus reports a win once the human's score overtakes the bot's", async () => {
    // Drives a Table directly (bypassing the WS layer) so the scenario is
    // fully synchronous and controllable: an "easy" (uniform-random) bot is
    // deliberately weaker than a human who always concentrates crosses in
    // the same row (triangular scoring rewards concentration), so the
    // human's total reliably overtakes the bot's within a bounded number of
    // turns, at which point the game is force-ended via `endGame` and the
    // resulting `daily.result.won` is asserted.
    const store = new MemoryStore();
    const dateKey = "2026-01-01";
    const presetRolls: FullDiceRoll[] = buildDailyRollSchedule(
      dailySeed(dateKey),
      100,
    );

    const table = new Table("WINTST", {
      store,
      botMoveDelayMs: { min: 0, max: 0 },
      botRandom: () => 0,
      presetRolls,
    });

    const humanId = "human-1";
    table.addSeat(humanId, "Alice", "human-token");
    const botResult = table.addBotSeat(humanId, "easy");
    expect(botResult.ok).toBe(true);
    if (!botResult.ok) throw new Error("unreachable");
    const botId = botResult.playerId;
    table.configureDaily(dateKey, humanId, botId);
    const startResult = table.startGame(humanId, { order: [botId, humanId] });
    expect(startResult.ok).toBe(true);

    const COLORS = ["red", "yellow", "green", "blue"] as const;
    const PREFERRED_ROW = "red";

    function totalScore(sheets: SnapshotMessage["sheets"], playerId: string): number {
      const sheet = sheets.find((s) => s.playerId === playerId)!;
      return COLORS.reduce((sum, c) => sum + sheet.rows[c].score, 0) - 5 * sheet.penalties;
    }

    // Always try the concentrated row first, falling back to any other
    // legal row — a stronger strategy than the bot's own per-turn choice.
    function tryWhiteCross(playerId: string, sumWhite: number): void {
      const order = [PREFERRED_ROW, ...COLORS.filter((c) => c !== PREFERRED_ROW)];
      for (const color of order) {
        const res = table.submitWhite(playerId, {
          kind: "cross",
          color,
          value: sumWhite,
        });
        if (res.ok) return;
      }
      table.submitWhite(playerId, { kind: "pass" });
    }

    function tryColorCross(
      playerId: string,
      roll: NonNullable<SnapshotMessage["roll"]>,
    ): void {
      const order = [PREFERRED_ROW, ...COLORS.filter((c) => c !== PREFERRED_ROW)];
      for (const color of order) {
        const colorValue = roll[color];
        if (colorValue === undefined) continue;
        for (const whiteDie of ["w1", "w2"] as const) {
          const value = roll[whiteDie] + colorValue;
          const res = table.submitColor(playerId, {
            kind: "cross",
            whiteDie,
            color,
            value,
          });
          if (res.ok) return;
        }
      }
      table.submitColor(playerId, { kind: "pass" });
    }

    // A resilient state-machine loop, not a "one iteration = one turn"
    // assumption: some turns auto-resolve synchronously with no action from
    // either side (nobody has a legal move for that roll), which can
    // cascade through several turns inside a single await boundary. So each
    // step just reacts to whatever the *current* snapshot shows, and checks
    // the score-overtake condition before every action (not just once per
    // assumed "turn"), ending the game the instant it's true.
    let won = false;
    for (let step = 0; step < 500; step++) {
      const snap = table.buildSnapshot(humanId);
      if (snap.lobbyState === "FINISHED") break;

      if (totalScore(snap.sheets, humanId) > totalScore(snap.sheets, botId)) {
        const res = table.endGame(humanId);
        won = res.ok;
        break;
      }

      if (snap.phase === "ROLLING" && snap.activePlayerId === humanId) {
        table.submitRoll(humanId);
      } else if (snap.phase === "WHITE" && snap.roll) {
        if (!snap.whiteSubmitted.includes(humanId)) {
          tryWhiteCross(humanId, snap.roll.w1 + snap.roll.w2);
        }
      } else if (snap.phase === "COLOR" && snap.activePlayerId === humanId) {
        tryColorCross(humanId, snap.roll!);
      }
      // Otherwise: the bot's own ROLLING/COLOR moment, or WHITE already
      // answered — nothing for the human to do this step, just let time pass.

      await sleep(5);
    }

    expect(won).toBe(true);
    const finalSnap = table.buildSnapshot(humanId);
    expect(finalSnap.daily).not.toBeNull();
    expect(finalSnap.daily!.result).not.toBeNull();
    expect(finalSnap.daily!.result!.won).toBe(true);
    expect(finalSnap.daily!.result!.playerTurns).toBeGreaterThan(0);

    store.close();
  });
});
