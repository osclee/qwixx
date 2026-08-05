import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { JoinedMessage, ServerMessage } from "../src/protocol.js";

describe("connection heartbeat", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("pings a healthy connection without dropping it", async () => {
    const server = await startTestServer({ heartbeatIntervalMs: 30 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    await alice.waitForType("joined");

    // A default `ws.WebSocket` auto-answers native ping frames, so a
    // healthy connection should receive app-level "ping" heartbeats and
    // stay open across several intervals rather than getting terminated.
    await alice.waitForType("ping");
    await alice.waitForType("ping");
    await alice.waitForType("ping");
  });

  it("terminates a connection that stops answering pings, unblocking the WHITE-phase barrier for others", async () => {
    // Deliberately long WHITE/COLOR timers, same as reconnect.test.ts: we
    // want to prove the heartbeat-driven disconnect itself (not a timeout)
    // is what unblocks the turn.
    const server = await startTestServer({
      heartbeatIntervalMs: 30,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
    });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    // A raw `ws` client with autoPong disabled never answers the server's
    // native pings, simulating a half-open connection (e.g. a sleeping
    // laptop or a dropped network path) that never sends a 'close' frame
    // on its own -- the exact scenario a naive implementation would hang
    // on forever without an active heartbeat.
    const zombie = new WebSocket(server.url, { autoPong: false });
    await new Promise<void>((resolve, reject) => {
      zombie.once("open", () => resolve());
      zombie.once("error", reject);
    });
    zombie.send(
      JSON.stringify({
        type: "join_table",
        roomCode: aliceJoined.roomCode,
        nickname: "Bob",
      }),
    );
    const bobJoined = await new Promise<JoinedMessage>((resolve) => {
      zombie.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        if (msg.type === "joined") resolve(msg);
      });
    });
    const zombieClosed = new Promise<void>((resolve) => {
      zombie.once("close", () => resolve());
    });

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const whiteSnap1 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    // Alice always may pass regardless of whose turn it is -- leaves the
    // WHITE barrier waiting on Bob's zombie connection alone.
    alice.send({ type: "submit_white", action: { kind: "pass" } });

    // The server should notice the missed pong and terminate the zombie
    // socket within roughly one heartbeat interval of it going quiet.
    await zombieClosed;

    // That termination fires 'close' server-side, which marks the seat
    // disconnected and rechecks the WHITE barrier immediately. Whether the
    // turn then needs Alice to act again in COLOR depends on who ended up
    // active (random turn order) -- if Bob is active, his disconnect
    // resolves COLOR on its own (see Table.enterColorPhase); if Alice is
    // active, only she can act there, so give her a harmless pass (a
    // no-op if it's not actually her turn -- the server just rejects it).
    const afterWhite = await alice.waitForSnapshot(
      (s) =>
        (s.phase === "WHITE" && s.turnSeq > whiteSnap1.turnSeq) ||
        s.phase === "COLOR",
      3000,
    );
    if (afterWhite.phase === "COLOR") {
      alice.send({ type: "submit_color", action: { kind: "pass" } });
    }
    const whiteSnap2 =
      afterWhite.phase === "WHITE"
        ? afterWhite
        : await alice.waitForSnapshot(
            (s) => s.phase === "WHITE" && s.turnSeq > whiteSnap1.turnSeq,
            3000,
          );
    expect(whiteSnap2.turnSeq).toBeGreaterThan(whiteSnap1.turnSeq);
    expect(
      whiteSnap2.sheets.find((s) => s.playerId === bobJoined.playerId)
        ?.connected,
    ).toBe(false);
  });
});
