import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("server-side move validation", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("rejects illegal/mismatched moves and never trusts the client's math", async () => {
    const server = await startTestServer({ seed: 3 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({ type: "join_table", roomCode: aliceJoined.roomCode, nickname: "Bob" });
    await bob.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const sumWhite = whiteSnap.roll.w1 + whiteSnap.roll.w2;
    const activePlayerId = whiteSnap.activePlayerId as string;
    const active = activePlayerId === aliceJoined.playerId ? alice : bob;
    const passive = active === alice ? bob : alice;

    // A value that doesn't match the actual white sum must be rejected.
    const bogusValue = sumWhite === 12 ? 2 : 12; // guaranteed different from sumWhite
    active.send({ type: "submit_white", action: { kind: "cross", color: "red", value: bogusValue } });
    const err1 = await active.waitForType("error");
    expect(err1.code).toBe("submit_white_failed");

    // A legitimate pass should now succeed...
    active.send({ type: "submit_white", action: { kind: "pass" } });
    // ...but submitting a second time this turn must be rejected.
    active.send({ type: "submit_white", action: { kind: "pass" } });
    const err2 = await active.waitForType("error");
    expect(err2.code).toBe("submit_white_failed");
    expect(err2.message).toMatch(/already submitted/i);

    passive.send({ type: "submit_white", action: { kind: "pass" } });

    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");

    // Only the active player may act during COLOR.
    passive.send({ type: "submit_color", action: { kind: "pass" } });
    const err3 = await passive.waitForType("error");
    expect(err3.code).toBe("submit_color_failed");
    expect(err3.message).toMatch(/active player/i);

    // The active player's math must actually add up (server recomputes it,
    // never trusts the client-supplied `value`).
    const bogusColorValue = (colorSnap.roll.w1 as number) + (colorSnap.roll.red as number) + 100;
    active.send({
      type: "submit_color",
      action: { kind: "cross", whiteDie: "w1", color: "red", value: bogusColorValue },
    });
    const err4 = await active.waitForType("error");
    expect(err4.code).toBe("submit_color_failed");

    // A real pass should finally close the turn out cleanly.
    active.send({ type: "submit_color", action: { kind: "pass" } });
    const whiteSnap2 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap2.turnSeq).toBeGreaterThan(whiteSnap.turnSeq);

    // None of the rejected attempts should have crossed anything.
    for (const sheet of whiteSnap2.sheets) {
      expect(sheet.rows.red.crossedValues).toHaveLength(0);
    }
  });
});
