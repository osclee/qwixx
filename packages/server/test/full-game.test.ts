import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { SnapshotMessage } from "../src/protocol.js";

describe("full game lifecycle over the WebSocket protocol", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("takes two players from create/join through a real cross to a scored finish", async () => {
    const server = await startTestServer({ seed: 42 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");
    const roomCode = aliceJoined.roomCode as string;
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);

    const bob = await TestClient.connect(server.url);
    bob.send({ type: "join_table", roomCode, nickname: "Bob" });
    const bobJoined = await bob.waitForType("joined");
    expect(bobJoined.roomCode).toBe(roomCode);

    // Lobby snapshot reaches both players. From here on, ALL phase-transition
    // tracking uses alice's stream only — she receives every broadcast
    // (including when bob is the active player), and reading from a single
    // client's message queue avoids desyncing two independent cursors
    // against one shared, ordered stream of turns.
    const aliceLobbySnap = await alice.waitForSnapshot(
      (s) => s.sheets.length === 2,
    );
    expect(aliceLobbySnap.lobbyState).toBe("LOBBY");
    expect(aliceLobbySnap.hostPlayerId).toBe(aliceJoined.playerId);

    // Only the host may start.
    bob.send({ type: "start_game" });
    const bobErr = await bob.waitForType("error");
    expect(bobErr.code).toBe("start_failed");

    alice.send({ type: "start_game" });

    // Turn 1, WHITE phase.
    let whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap.roll).not.toBeNull();
    const turn1ActivePlayerId = whiteSnap.activePlayerId as string;

    // Everyone passes the white sum this turn — pass/decline is the common
    // path every turn in this test; rule minutiae are the engine package's job.
    alice.send({ type: "submit_white", action: { kind: "pass" } });
    bob.send({ type: "submit_white", action: { kind: "pass" } });

    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");
    const roll = colorSnap.roll;
    const activeClient =
      turn1ActivePlayerId === aliceJoined.playerId ? alice : bob;

    // The active player takes one real, legal cross via the color combo so
    // we also exercise the success path (not just pass/error), using the
    // actual broadcast roll. Skip the rare case where w1+red lands on the
    // terminal value (12), which would be illegal on a blank row.
    const comboValue = roll.w1 + roll.red;
    const tookRealCross = comboValue !== 12;
    if (tookRealCross) {
      activeClient.send({
        type: "submit_color",
        action: {
          kind: "cross",
          whiteDie: "w1",
          color: "red",
          value: comboValue,
        },
      });
    } else {
      activeClient.send({ type: "submit_color", action: { kind: "pass" } });
    }
    await alice.waitForType("event"); // the cross (or "took a penalty") gets logged

    // Confirm the cross landed in the very next WHITE-phase snapshot, on the
    // active player's own sheet.
    whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap.turnSeq).toBeGreaterThan(colorSnap.turnSeq - 1);
    if (tookRealCross) {
      const activeSheet = whiteSnap.sheets.find(
        (sh) => sh.playerId === turn1ActivePlayerId,
      );
      expect(activeSheet!.rows.red.crossedValues).toContain(comboValue);
    }

    // Drive the rest of the game to completion purely by passing everything.
    // With nobody ever crossing again, this deterministically ends via the
    // 4-penalty condition (§7a) within a handful of alternating turns.
    const finalSnap = await runToFinish(
      alice,
      bob,
      aliceJoined.playerId,
      whiteSnap,
    );

    expect(finalSnap.lobbyState).toBe("FINISHED");
    expect(finalSnap.phase).toBe("FINISHED");
    expect(finalSnap.results).toHaveLength(2);
    for (const result of finalSnap.results!) {
      expect(typeof result.total).toBe("number");
      expect([1, 2]).toContain(result.rank);
    }
    const anyMaxedPenalty = finalSnap.sheets.some((s) => s.penalties === 4);
    const twoColorsRemoved = finalSnap.removedColors.length >= 2;
    expect(anyMaxedPenalty || twoColorsRemoved).toBe(true);
  });
});

/**
 * Passes every white and color decision, turn after turn, until a FINISHED
 * snapshot arrives (or a safety cap is hit). All phase tracking reads from
 * `alice`'s stream only (see rationale above); `bob` is only ever a send
 * target, never awaited on, so the two clients' independent message cursors
 * can't drift apart.
 */
async function runToFinish(
  alice: TestClient,
  bob: TestClient,
  alicePlayerId: string,
  firstWhiteSnapshot: SnapshotMessage,
): Promise<SnapshotMessage> {
  let whiteSnap = firstWhiteSnapshot;
  for (let turn = 0; turn < 60; turn++) {
    if (whiteSnap.phase === "FINISHED") return whiteSnap;

    alice.send({ type: "submit_white", action: { kind: "pass" } });
    bob.send({ type: "submit_white", action: { kind: "pass" } });

    const colorOrFinished = (await alice.waitFor(
      (m) =>
        m.type === "snapshot" &&
        (m.phase === "COLOR" || m.phase === "FINISHED"),
    )) as SnapshotMessage;
    if (colorOrFinished.phase === "FINISHED") return colorOrFinished;

    const active =
      colorOrFinished.activePlayerId === alicePlayerId ? alice : bob;
    active.send({ type: "submit_color", action: { kind: "pass" } });

    whiteSnap = (await alice.waitFor(
      (m) =>
        m.type === "snapshot" &&
        (m.phase === "WHITE" || m.phase === "FINISHED"),
    )) as SnapshotMessage;
  }
  throw new Error("Game did not finish within 60 turns");
}
