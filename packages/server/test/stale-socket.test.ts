import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A half-open socket (laptop sleep, network handoff, a proxy reaping an idle
 * connection) produces no 'close' event until either side notices — which
 * means the *client* can give up first, reconnect, and rejoin its seat
 * while the server still holds the dead socket open. The dead socket's
 * 'close' then lands *after* the new one has already attached.
 *
 * That late close must not tear down the live connection that replaced it.
 */
describe("a stale socket closing after the player already reconnected", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("leaves the reconnected socket attached and still receiving updates", async () => {
    const server = await startTestServer({
      seed: 11,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
    });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bobOld = await TestClient.connect(server.url);
    bobOld.send({
      type: "join_table",
      roomCode: aliceJoined.roomCode,
      nickname: "Bob",
    });
    const bobJoined = await bobOld.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });
    const whiteSnap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap.turnSeq).toBe(0);

    // Alice answers, so the WHITE barrier is now waiting on Bob alone.
    alice.send({ type: "submit_white", action: { kind: "pass" } });

    // Bob's socket is silently dead; his client notices, reconnects, and
    // rejoins on a fresh socket. The server still believes the old one is
    // alive at this point.
    const bobNew = await TestClient.connect(server.url);
    bobNew.send({ type: "rejoin", sessionToken: bobJoined.sessionToken });
    await bobNew.waitForType("snapshot");
    await bobNew.waitForType("joined");

    // Only now does the dead socket finally close (in production: the
    // server's own heartbeat gives up on it and calls ws.terminate()).
    bobOld.close();
    await sleep(250);

    // Bob is still very much here — his seat must not have been marked
    // absent by his own stale socket's close.
    bobNew.send({ type: "submit_white", action: { kind: "pass" } });
    const colorSnap = await bobNew.waitForSnapshot(
      (s) => s.phase === "COLOR",
      2000,
    );
    const bobSheet = colorSnap.sheets.find(
      (s) => s.playerId === bobJoined.playerId,
    );
    expect(bobSheet!.connected).toBe(true);
  });

  it("releases the previous seat when one socket rebinds to a different table", async () => {
    const server = await startTestServer({ seed: 7 });
    close = server.close;

    // Alice and Bob are together in the first room.
    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const firstRoom = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({
      type: "join_table",
      roomCode: firstRoom.roomCode,
      nickname: "Bob",
    });
    await bob.waitForType("joined");
    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    // Alice reuses the same socket to open a second room without leaving the
    // first. Her old seat has no socket of its own to ever close, so the
    // rebind is the only chance to mark it absent — otherwise it sits in the
    // first room as a permanently "connected" ghost, blocking that table's
    // phase barriers for everyone still there.
    alice.send({ type: "create_table", nickname: "Alice" });
    const secondRoom = await alice.waitForType("joined");
    expect(secondRoom.roomCode).not.toBe(firstRoom.roomCode);

    // A fresh arrival in the first room sees Alice's abandoned seat as gone.
    const carol = await TestClient.connect(server.url);
    carol.send({
      type: "join_table",
      roomCode: firstRoom.roomCode,
      nickname: "Carol",
    });
    const carolSnap = await carol.waitForSnapshot((s) => s.sheets.length === 3);
    const ghost = carolSnap.sheets.find(
      (s) => s.playerId === firstRoom.playerId,
    );
    expect(ghost!.connected).toBe(false);
  });
});
