import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("disconnect and rejoin", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("instantly unblocks a stuck phase on disconnect, then lets the same seat rejoin mid-game", async () => {
    // Deliberately long timers: we want to prove the disconnect itself
    // (not a timeout) is what unblocks the turn.
    const server = await startTestServer({
      seed: 11,
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

    // Consume turn 1's WHITE snapshot from BOTH clients' streams — whichever
    // one turns out to be `stayingClient` below must have its cursor past
    // this message already, or its next waitFor would re-match this stale
    // snapshot instead of advancing to turn 2's.
    const whiteSnap1 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    await bob.waitForSnapshot((s) => s.phase === "WHITE");
    const activePlayerId = whiteSnap1.activePlayerId as string;
    const activeIsAlice = activePlayerId === aliceJoined.playerId;

    const goneClient = activeIsAlice ? alice : bob;
    const goneSession = activeIsAlice
      ? aliceJoined.sessionToken
      : bobJoined.sessionToken;
    const gonePlayerId = activeIsAlice
      ? aliceJoined.playerId
      : bobJoined.playerId;
    // The client that stays connected throughout — all phase tracking after
    // the disconnect reads from this one stream only.
    const stayingClient = activeIsAlice ? bob : alice;

    // The staying (non-active) player passes the white sum...
    stayingClient.send({ type: "submit_white", action: { kind: "pass" } });
    // ...then the active player's tab closes before they ever answer.
    goneClient.close();

    // No timers should be needed: the disconnect itself should unblock
    // WHITE (only the staying player is now "connected"), and since the
    // active player is gone, COLOR should auto-resolve too — landing
    // directly on turn 2's WHITE phase with the disconnected player
    // penalized, well within a short timeout. Note: an intermediate
    // phase==='WHITE' broadcast may arrive first, reflecting only that the
    // staying player has answered while the disconnect is still in flight —
    // so wait specifically for turnSeq to advance, not just the phase.
    const whiteSnap2 = await stayingClient.waitForSnapshot(
      (s) => s.phase === "WHITE" && s.turnSeq > whiteSnap1.turnSeq,
      3000,
    );
    expect(whiteSnap2.turnSeq).toBeGreaterThan(whiteSnap1.turnSeq);

    const goneSheet = whiteSnap2.sheets.find(
      (s) => s.playerId === gonePlayerId,
    );
    expect(goneSheet!.penalties).toBe(1);
    expect(goneSheet!.connected).toBe(false);

    // Now the same browser tab "reopens" and rejoins with its stored session
    // token. attachConnection sends its snapshot (and recent events)
    // synchronously before the explicit "joined" reply goes out, so read
    // the snapshot first.
    const rejoined = await TestClient.connect(server.url);
    rejoined.send({ type: "rejoin", sessionToken: goneSession });
    const snapOnRejoin = await rejoined.waitForType("snapshot");
    const joinedAgain = await rejoined.waitForType("joined");
    expect(joinedAgain.playerId).toBe(gonePlayerId);
    expect(joinedAgain.roomCode).toBe(aliceJoined.roomCode);

    expect(snapOnRejoin.turnSeq).toBe(whiteSnap2.turnSeq);
    const ownSheetOnRejoin = snapOnRejoin.sheets.find(
      (s) => s.playerId === gonePlayerId,
    );
    expect(ownSheetOnRejoin!.penalties).toBe(1);
    expect(ownSheetOnRejoin!.connected).toBe(true);

    // Prove the reconnected socket is fully wired for future turns: both
    // players (staying + rejoined) can act again this same turn.
    stayingClient.send({ type: "submit_white", action: { kind: "pass" } });
    rejoined.send({ type: "submit_white", action: { kind: "pass" } });

    const colorSnap = await stayingClient.waitForSnapshot(
      (s) => s.phase === "COLOR",
      3000,
    );
    const nowActive =
      colorSnap.activePlayerId === gonePlayerId ? rejoined : stayingClient;
    nowActive.send({ type: "submit_color", action: { kind: "pass" } });

    const whiteSnap3 = await stayingClient.waitForSnapshot(
      (s) => s.phase === "WHITE" && s.turnSeq > whiteSnap2.turnSeq,
      3000,
    );
    expect(whiteSnap3.turnSeq).toBeGreaterThan(whiteSnap2.turnSeq);
  });
});
