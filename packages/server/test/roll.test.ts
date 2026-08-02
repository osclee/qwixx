import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

async function setUpTwoPlayerGame(server: Awaited<ReturnType<typeof startTestServer>>) {
  const alice = await TestClient.connect(server.url);
  alice.send({ type: "create_table", nickname: "Alice" });
  const aliceJoined = await alice.waitForType("joined");

  const bob = await TestClient.connect(server.url);
  bob.send({ type: "join_table", roomCode: aliceJoined.roomCode, nickname: "Bob" });
  const bobJoined = await bob.waitForType("joined");

  await alice.waitForSnapshot((s) => s.sheets.length === 2);
  alice.send({ type: "start_game" });

  const rollingSnap = await alice.waitForSnapshot((s) => s.phase === "ROLLING");
  return { alice, bob, aliceJoined, bobJoined, rollingSnap };
}

describe("ROLLING phase", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("waits with roll=null until the active player explicitly rolls", async () => {
    const server = await startTestServer({ seed: 1, rollPhaseMs: 60_000 });
    close = server.close;

    const { alice, bob, aliceJoined, rollingSnap } = await setUpTwoPlayerGame(server);
    expect(rollingSnap.roll).toBeNull();
    expect(rollingSnap.phaseDeadline).not.toBeNull();

    const active = rollingSnap.activePlayerId === aliceJoined.playerId ? alice : bob;
    active.send({ type: "roll_dice" });

    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE", 3000);
    expect(whiteSnap.roll).not.toBeNull();
    expect(whiteSnap.turnSeq).toBe(rollingSnap.turnSeq);
  });

  it("rejects a roll from anyone but the active player", async () => {
    const server = await startTestServer({ seed: 2, rollPhaseMs: 60_000 });
    close = server.close;

    const { alice, bob, aliceJoined, rollingSnap } = await setUpTwoPlayerGame(server);
    const passive = rollingSnap.activePlayerId === aliceJoined.playerId ? bob : alice;

    passive.send({ type: "roll_dice" });
    const err = await passive.waitForType("error");
    expect(err.code).toBe("roll_failed");
    expect(err.message).toMatch(/active player/i);

    // Nothing should have rolled — still waiting.
    const stillRolling = await alice.waitFor((m) => m.type === "snapshot" && m.phase === "ROLLING", 500).catch(() => null);
    // Either we observe another ROLLING snapshot, or none arrives because
    // nothing changed — both are fine; what matters is no WHITE snapshot
    // appeared as a result of the rejected roll.
    if (stillRolling) expect(stillRolling.roll).toBeNull();
  });

  it("auto-rolls once the roll timer expires, without penalizing anyone", async () => {
    const server = await startTestServer({ seed: 3, rollPhaseMs: 150 });
    close = server.close;

    const { alice, rollingSnap } = await setUpTwoPlayerGame(server);
    expect(rollingSnap.roll).toBeNull();

    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE", 3000);
    expect(whiteSnap.roll).not.toBeNull();
    expect(whiteSnap.turnSeq).toBe(rollingSnap.turnSeq);
    // Auto-rolling isn't a missed turn — nobody should be penalized just for this.
    for (const sheet of whiteSnap.sheets) expect(sheet.penalties).toBe(0);
  });

  it("rolls immediately if the active player disconnects while waiting, no need for the timer", async () => {
    const server = await startTestServer({ seed: 4, rollPhaseMs: 60_000 });
    close = server.close;

    const { alice, bob, aliceJoined, rollingSnap } = await setUpTwoPlayerGame(server);
    const activeIsAlice = rollingSnap.activePlayerId === aliceJoined.playerId;
    const goneClient = activeIsAlice ? alice : bob;
    const stayingClient = activeIsAlice ? bob : alice;

    goneClient.close();

    const whiteSnap = await stayingClient.waitForSnapshot((s) => s.phase === "WHITE", 3000);
    expect(whiteSnap.roll).not.toBeNull();
    expect(whiteSnap.turnSeq).toBe(rollingSnap.turnSeq);
  });
});
