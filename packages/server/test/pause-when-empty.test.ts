import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bot seats are permanently `connected`, so the "don't cascade through an
 * empty table" guard in `allConnectedHaveAnswered` never engages at a table
 * that has one. Left alone, the bots answer every barrier instantly and the
 * absent humans auto-pass and take a penalty each turn, running the game to
 * a 4-penalty finish within seconds of a blip — 1.5s away was enough to lose
 * an entire Daily Challenge attempt.
 */
describe("a live game with no humans connected", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("parks where it stands instead of letting the bots finish it, and picks back up on reconnect", async () => {
    const server = await startTestServer({
      seed: 5,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
      botMoveDelayMs: { min: 0, max: 5 },
    });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const joined = await alice.waitForType("joined");
    alice.send({ type: "add_bot", difficulty: "hard" });
    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const before = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(before.turnSeq).toBe(0);

    // The only human vanishes. Nothing should move without her.
    alice.close();
    await sleep(1500);

    const back = await TestClient.connect(server.url);
    back.send({ type: "rejoin", sessionToken: joined.sessionToken });
    const parked = await back.waitForType("snapshot");

    expect(parked.lobbyState).toBe("IN_PROGRESS");
    expect(parked.turnSeq).toBe(before.turnSeq);
    expect(parked.phase).toBe("WHITE");
    // Not one auto-passed turn, and above all not the four penalties that
    // used to accumulate while she was away.
    const own = parked.sheets.find((s) => s.playerId === joined.playerId);
    expect(own!.penalties).toBe(0);

    // ...and the game is genuinely live again, not just frozen prettily:
    // her answers carry the turn through to the next one.
    await back.waitForType("joined");
    back.send({ type: "submit_white", action: { kind: "pass" } });
    const colorSnap = await back.waitForSnapshot((s) => s.phase === "COLOR");
    if (colorSnap.activePlayerId === joined.playerId) {
      back.send({ type: "submit_color", action: { kind: "pass" } });
    }
    const resumed = await back.waitForSnapshot(
      (s) => s.turnSeq > before.turnSeq,
      3000,
    );
    expect(resumed.lobbyState).toBe("IN_PROGRESS");
  });

  it("keeps playing normally while any human is still connected", async () => {
    const server = await startTestServer({
      seed: 5,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
      botMoveDelayMs: { min: 0, max: 5 },
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
    await bob.waitForType("joined");

    alice.send({ type: "add_bot", difficulty: "easy" });
    await alice.waitForSnapshot((s) => s.sheets.length === 3);
    alice.send({ type: "start_game" });

    const before = await alice.waitForSnapshot((s) => s.phase === "WHITE");

    // Bob drops, but Alice is still here — one absent player must never
    // stall the table for the people who stayed.
    bob.close();
    alice.send({ type: "submit_white", action: { kind: "pass" } });
    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");
    if (colorSnap.activePlayerId === aliceJoined.playerId) {
      alice.send({ type: "submit_color", action: { kind: "pass" } });
    }

    const advanced = await alice.waitForSnapshot(
      (s) => s.turnSeq > before.turnSeq,
      3000,
    );
    expect(advanced.lobbyState).toBe("IN_PROGRESS");
  });

  it("resumes a parked white phase without reopening answers already given", async () => {
    const server = await startTestServer({
      seed: 5,
      whitePhaseMs: 60_000,
      colorPhaseMs: 60_000,
      botMoveDelayMs: { min: 0, max: 5 },
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
    await bob.waitForType("joined");

    alice.send({ type: "add_bot", difficulty: "easy" });
    await alice.waitForSnapshot((s) => s.sheets.length === 3);
    alice.send({ type: "start_game" });

    const white = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const sumWhite = white.roll!.w1 + white.roll!.w2;
    // 12 is the terminal cell on a red row and needs five prior crosses, so
    // it's the one sum that isn't legal there on a blank sheet.
    const crossed = sumWhite !== 12;
    alice.send(
      crossed
        ? {
            type: "submit_white",
            action: { kind: "cross", color: "red", value: sumWhite },
          }
        : { type: "submit_white", action: { kind: "pass" } },
    );
    await alice.waitForSnapshot((s) =>
      s.whiteSubmitted.includes(aliceJoined.playerId),
    );

    // Both humans leave with Alice's answer already in and Bob's still
    // outstanding, parking the table mid-phase. Alice must go first and be
    // seen to go first: if Bob's close lands first, Alice-plus-bot satisfies
    // the barrier, WHITE closes on its own, and the table ends up parked in
    // COLOR instead — which wouldn't exercise anything below.
    alice.close();
    await sleep(150);
    bob.close();
    await sleep(150);

    // Alice comes back alone. Re-entering the phase from the top here would
    // wipe pendingWhite — handing her a second free cross on a sum she has
    // already taken, and reopening a barrier for a player who has left.
    const back = await TestClient.connect(server.url);
    back.send({ type: "rejoin", sessionToken: aliceJoined.sessionToken });
    const parked = await back.waitForType("snapshot");
    expect(parked.phase).toBe("WHITE");
    expect(parked.whiteSubmitted).toContain(aliceJoined.playerId);

    // Her answer plus the bot's is the whole connected table, so resuming
    // closes the phase straight away rather than waiting on absent Bob.
    const colorSnap = await back.waitForSnapshot(
      (s) => s.phase === "COLOR",
      3000,
    );
    const own = colorSnap.sheets.find(
      (s) => s.playerId === aliceJoined.playerId,
    );
    expect(own!.rows.red.crossedValues).toHaveLength(crossed ? 1 : 0);
  });
});
