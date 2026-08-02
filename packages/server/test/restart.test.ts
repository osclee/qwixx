import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { tryCreateSqliteStore } from "../src/store/sqlite.js";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";

describe("restart durability (SQLite-backed)", () => {
  let close: (() => Promise<void>) | null = null;
  let dbPath: string | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
    if (dbPath) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.rmSync(dbPath + suffix);
        } catch {
          // fine if it never existed
        }
      }
    }
    dbPath = null;
  });

  it("rehydrates an in-progress table from its last snapshot after the process restarts", async () => {
    dbPath = path.join(os.tmpdir(), `quixx-test-${randomUUID()}.sqlite`);

    const store1 = await tryCreateSqliteStore(dbPath);
    expect(store1).not.toBeNull(); // if this is null, better-sqlite3 failed to build — see store/sqlite.ts fallback

    const server1 = await startTestServer({ seed: 5, store: store1! });
    close = server1.close;

    const alice = await TestClient.connect(server1.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server1.url);
    bob.send({ type: "join_table", roomCode: aliceJoined.roomCode, nickname: "Bob" });
    const bobJoined = await bob.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);
    alice.send({ type: "start_game" });

    const whiteSnap1 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const activePlayerId = whiteSnap1.activePlayerId as string;

    // Play turn 1 out completely (everyone passes) so resolveAndContinue
    // persists a snapshot with turnSeq=1 and a penalty for whoever was active.
    alice.send({ type: "submit_white", action: { kind: "pass" } });
    bob.send({ type: "submit_white", action: { kind: "pass" } });
    const colorSnap = await alice.waitForSnapshot((s) => s.phase === "COLOR");
    const active = colorSnap.activePlayerId === aliceJoined.playerId ? alice : bob;
    active.send({ type: "submit_color", action: { kind: "pass" } });
    const whiteSnap2 = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    expect(whiteSnap2.turnSeq).toBe(1);

    // "The server restarts": close everything down (including the sqlite
    // connection) without any graceful game-level shutdown.
    await server1.close();
    close = null;

    // Bring up a brand new app/registry pointed at the same database file —
    // this is exactly what happens on a real process restart.
    const store2 = await tryCreateSqliteStore(dbPath);
    const server2 = await startTestServer({ seed: 999, store: store2! });
    close = server2.close;

    // The original browser tab "reopens" and rejoins with its stored token,
    // now against the new process/port. attachConnection sends its snapshot
    // (or two, if this is the reconnect that resumes a restored table —
    // see Table.restore) synchronously before the explicit "joined" reply
    // goes out, so read the snapshot first.
    const rejoined = await TestClient.connect(server2.url);
    rejoined.send({ type: "rejoin", sessionToken: aliceJoined.sessionToken });
    const restoredSnap = await rejoined.waitForType("snapshot");
    const joinedAgain = await rejoined.waitForType("joined");
    expect(joinedAgain.playerId).toBe(aliceJoined.playerId);
    expect(joinedAgain.roomCode).toBe(aliceJoined.roomCode);

    expect(restoredSnap.lobbyState).toBe("IN_PROGRESS");
    expect(restoredSnap.sheets).toHaveLength(2);
    const restoredActiveSheet = restoredSnap.sheets.find((s: any) => s.playerId === activePlayerId);
    expect(restoredActiveSheet.penalties).toBe(1); // survived the restart
  });
});
