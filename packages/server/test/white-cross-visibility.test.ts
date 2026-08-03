import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("white-phase cross visibility", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("shows a player's white cross immediately, before other players (including the active one) have answered", async () => {
    // Long white timer: we want this to hinge on the immediate broadcast,
    // not a timeout closing the phase behind our backs.
    const server = await startTestServer({
      seed: 6,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
    });
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
    const bobJoined = await bob.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const sumWhite = whiteSnap.roll.w1 + whiteSnap.roll.w2;
    const activePlayerId = whiteSnap.activePlayerId as string;

    // The PASSIVE (non-active) player submits their cross first — this is
    // exactly the reported scenario: someone who isn't the active player
    // takes the white square before the active player has acted.
    const passive = activePlayerId === aliceJoined.playerId ? bob : alice;
    const passivePlayerId =
      passive === alice ? aliceJoined.playerId : bobJoined.playerId;

    // Skip the rare case where the white sum happens to be the terminal
    // value (12), which would be illegal on a blank row.
    if (sumWhite === 12) return;

    passive.send({
      type: "submit_white",
      action: { kind: "cross", color: "red", value: sumWhite },
    });

    // The very next broadcast — while the active player STILL hasn't
    // answered — must already show the cross on the passive player's sheet.
    const midWaitSnap = await alice.waitForSnapshot((s) =>
      s.whiteSubmitted.includes(passivePlayerId),
    );
    expect(midWaitSnap.phase).toBe("WHITE"); // still waiting on the active player
    const passiveSheet = midWaitSnap.sheets.find(
      (s) => s.playerId === passivePlayerId,
    );
    expect(passiveSheet!.rows.red.crossedValues).toContain(sumWhite);
  });
});
