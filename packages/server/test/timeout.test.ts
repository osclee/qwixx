import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("phase timers", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("auto-passes both phases on timeout and penalizes the active player who never answered", async () => {
    const server = await startTestServer({ seed: 7, whitePhaseMs: 150, colorPhaseMs: 150 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({ type: "join_table", roomCode: aliceJoined.roomCode, nickname: "Bob" });
    await bob.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const whiteSnap1 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap1.phaseDeadline).not.toBeNull();
    const activePlayerId = whiteSnap1.activePlayerId as string;

    // Nobody sends anything at all. The white-phase timer (150ms) should
    // fire, auto-passing both players into COLOR; the color-phase timer
    // (150ms) should then fire too, auto-passing the active player.
    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR", 3000);
    expect(colorSnap.activePlayerId).toBe(activePlayerId);

    const whiteSnap2 = await alice.waitForSnapshot((s) => s.phase === "WHITE", 3000);
    expect(whiteSnap2.turnSeq).toBeGreaterThan(whiteSnap1.turnSeq);

    const activeSheet = whiteSnap2.sheets.find((s: any) => s.playerId === activePlayerId);
    expect(activeSheet.penalties).toBe(1);

    // Active seat should have rotated to the other player for turn 2.
    expect(whiteSnap2.activePlayerId).not.toBe(activePlayerId);
  });
});
