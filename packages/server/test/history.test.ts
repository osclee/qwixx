import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { GameHistoryResponse } from "../src/protocol.js";

describe("GET /api/tables/:roomCode/history", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("404s for a room that was never finished", async () => {
    const server = await startTestServer();
    close = server.close;

    const res = await server.app.inject({
      method: "GET",
      url: "/api/tables/ZZZZZ/history",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns nicknamed, ranked results once the host ends the game", async () => {
    const server = await startTestServer();
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");
    const roomCode = aliceJoined.roomCode as string;

    const bob = await TestClient.connect(server.url);
    bob.send({ type: "join_table", roomCode, nickname: "Bob" });
    await bob.waitForType("joined");
    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    alice.send({ type: "start_game" });
    await alice.waitForSnapshot((s) => s.lobbyState === "IN_PROGRESS");

    // Not finished yet — history should still 404.
    const tooEarly = await server.app.inject({
      method: "GET",
      url: `/api/tables/${roomCode}/history`,
    });
    expect(tooEarly.statusCode).toBe(404);

    alice.send({ type: "end_game" });
    const finalSnap = await alice.waitForSnapshot(
      (s) => s.lobbyState === "FINISHED",
    );
    expect(finalSnap.results).not.toBeNull();

    // Lowercase + mixed case should resolve the same room, matching how
    // room codes are normalized elsewhere (registry.getTable uppercases).
    const res = await server.app.inject({
      method: "GET",
      url: `/api/tables/${roomCode.toLowerCase()}/history`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GameHistoryResponse;
    expect(body.roomCode).toBe(roomCode);
    expect(typeof body.createdAt).toBe("number");
    expect(body.results).toHaveLength(2);

    const nicknames = body.results.map((r) => r.nickname).sort();
    expect(nicknames).toEqual(["Alice", "Bob"]);
    for (const r of body.results) {
      expect(typeof r.total).toBe("number");
      expect([1, 2]).toContain(r.rank);
    }
  });
});
