import { randomUUID } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { COLORS, createGame } from "@quixx/engine";
import { serializeGameState } from "../src/serialize.js";
import { MemoryStore } from "../src/store/memory.js";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("COLOR phase with no legal move", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("still broadcasts a COLOR snapshot before the turn advances, even though the active player has no legal color move", async () => {
    // Seed a table (via the store, the same mechanism restart.test.ts uses)
    // whose active player has every row locked, so hasAnyLegalColorMove is
    // false the instant COLOR is entered — the exact condition that hits
    // enterColorPhase's early-return branch in table.ts.
    const roomCode = "ABCDE";
    const aliceId = randomUUID();
    const bobId = randomUUID();
    const aliceToken = randomUUID();
    const bobToken = randomUUID();

    const state = createGame([aliceId, bobId]);
    for (const color of COLORS) {
      state.sheets[aliceId]!.rows[color].locked = true;
    }

    const store = new MemoryStore();
    store.saveTable({
      roomCode,
      hostPlayerId: aliceId,
      seats: [
        { playerId: aliceId, nickname: "Alice", sessionToken: aliceToken, isBot: false, botDifficulty: null },
        { playerId: bobId, nickname: "Bob", sessionToken: bobToken, isBot: false, botDifficulty: null },
      ],
      createdAt: Date.now(),
    });
    store.saveSnapshot(roomCode, state.turnSeq, JSON.stringify(serializeGameState(state)));

    // Restored tables stay paused until the first reconnect (see Table.restore).
    const server = await startTestServer({ seed: 5, store });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "rejoin", sessionToken: aliceToken });
    // Reconnecting resumes the paused table (beginRoll -> auto-roll -> WHITE,
    // where alice also has no legal white move so WHITE closes immediately
    // too) straight through to COLOR. Bob never reconnects, so alice's
    // stream is the only one that matters.
    await alice.waitForType("joined");

    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");
    expect(colorSnap.activePlayerId).toBe(aliceId);
    expect(colorSnap.turnSeq).toBe(0);
    expect(colorSnap.roll).not.toBeNull();

    // All four of alice's rows were already locked, so resolveTurn removes
    // all four colors this turn and the game ends immediately (2+ colors
    // removed) — confirming the turn actually progressed past COLOR rather
    // than getting stuck, and that alice took the expected no-cross penalty.
    const finalSnap = await alice.waitForSnapshot((s) => s.phase === "FINISHED");
    expect(finalSnap.lobbyState).toBe("FINISHED");
    const aliceSheet = finalSnap.sheets.find((s: any) => s.playerId === aliceId);
    expect(aliceSheet.penalties).toBe(1);
    expect(finalSnap.results.some((r: any) => r.playerId === aliceId)).toBe(true);
  });
});
