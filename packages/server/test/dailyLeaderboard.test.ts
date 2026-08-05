import { afterEach, describe, expect, it } from "vitest";
import { buildDailyLeaderboardResponse } from "../src/dailyLeaderboard.js";
import { dailyDateKey } from "../src/daily.js";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { StoredDailyResult } from "../src/store/index.js";
import type { DailyLeaderboardResponse, SnapshotMessage } from "../src/protocol.js";

function entry(overrides: Partial<StoredDailyResult>): StoredDailyResult {
  return {
    dateKey: "2026-08-05",
    nickname: "Player",
    playerId: "p1",
    won: true,
    playerTurns: 5,
    total: 40,
    playedAt: 1000,
    ...overrides,
  };
}

describe("buildDailyLeaderboardResponse", () => {
  it("ranks winners by fewest turns, tie-broken by who reached it first", () => {
    const res = buildDailyLeaderboardResponse("2026-08-05", [
      entry({ nickname: "Slow", playerTurns: 10, playedAt: 100 }),
      entry({ nickname: "Fast", playerTurns: 5, playedAt: 200 }),
      entry({ nickname: "TiedA", playerTurns: 7, playedAt: 300 }),
      entry({ nickname: "TiedB", playerTurns: 7, playedAt: 50 }),
    ]);

    expect(res.winners.map((w) => w.nickname)).toEqual([
      "Fast",
      "TiedB", // same turn count as TiedA, but played earlier
      "TiedA",
      "Slow",
    ]);
    expect(res.winners.map((w) => w.rank)).toEqual([1, 2, 2, 4]); // ties share a rank, next rank skips
    expect(res.totalWinners).toBe(4);
    expect(res.totalPlayers).toBe(4);
  });

  it("excludes losses from the ranked list but still counts them", () => {
    const res = buildDailyLeaderboardResponse("2026-08-05", [
      entry({ nickname: "Winner", won: true, playerTurns: 6 }),
      entry({ nickname: "Loser", won: false, playerTurns: null }),
    ]);
    expect(res.winners).toHaveLength(1);
    expect(res.winners[0]?.nickname).toBe("Winner");
    expect(res.totalPlayers).toBe(2);
    expect(res.totalWinners).toBe(1);
  });

  it("returns an empty leaderboard for a day nobody has played", () => {
    const res = buildDailyLeaderboardResponse("2026-08-05", []);
    expect(res.winners).toEqual([]);
    expect(res.totalPlayers).toBe(0);
    expect(res.totalWinners).toBe(0);
  });
});

describe("GET /api/daily/:dateKey/leaderboard", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("400s on a malformed date key", async () => {
    const server = await startTestServer();
    close = server.close;
    const res = await server.app.inject({
      method: "GET",
      url: "/api/daily/not-a-date/leaderboard",
    });
    expect(res.statusCode).toBe(400);
  });

  it("aggregates saved results and serves them ranked", async () => {
    const server = await startTestServer();
    close = server.close;

    server.store.saveDailyResult(
      entry({ dateKey: "2026-08-05", nickname: "Alice", playerTurns: 8, playedAt: 1 }),
    );
    server.store.saveDailyResult(
      entry({ dateKey: "2026-08-05", nickname: "Bob", playerTurns: 4, playedAt: 2 }),
    );
    server.store.saveDailyResult(
      entry({
        dateKey: "2026-08-05",
        nickname: "Carol",
        won: false,
        playerTurns: null,
        playedAt: 3,
      }),
    );
    // A different day shouldn't leak into this day's leaderboard.
    server.store.saveDailyResult(
      entry({ dateKey: "2026-08-04", nickname: "Yesterday", playerTurns: 1, playedAt: 4 }),
    );

    const res = await server.app.inject({
      method: "GET",
      url: "/api/daily/2026-08-05/leaderboard",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DailyLeaderboardResponse;
    expect(body.dateKey).toBe("2026-08-05");
    expect(body.totalPlayers).toBe(3);
    expect(body.totalWinners).toBe(2);
    expect(body.winners.map((w) => w.nickname)).toEqual(["Bob", "Alice"]);
  });

  it("records a real finished daily table's loss into the leaderboard", async () => {
    const server = await startTestServer({ botMoveDelayMs: { min: 0, max: 5 } });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_daily_table", nickname: "AliceLoser" });
    await alice.waitForType("joined");
    let snap = await alice.waitForSnapshot((s) => s.phase === "WHITE");
    const dateKey = snap.daily!.dateKey;

    // Always pass, guaranteeing a loss (same pattern as daily.test.ts).
    for (let turn = 0; turn < 80 && snap.phase !== "FINISHED"; turn++) {
      const turnSeq = snap.turnSeq;
      alice.send({ type: "submit_white", action: { kind: "pass" } });
      const next = (await alice.waitFor(
        (m) =>
          m.type === "snapshot" &&
          (m.phase === "FINISHED" ||
            m.phase === "COLOR" ||
            (m.phase === "WHITE" && m.turnSeq > turnSeq)),
      )) as SnapshotMessage;
      if (next.phase === "COLOR") {
        if (next.activePlayerId === next.you) {
          alice.send({ type: "submit_color", action: { kind: "pass" } });
        }
        snap = (await alice.waitFor(
          (m) =>
            m.type === "snapshot" &&
            (m.phase === "WHITE" || m.phase === "FINISHED"),
        )) as SnapshotMessage;
      } else {
        snap = next;
      }
    }
    expect(snap.lobbyState).toBe("FINISHED");
    expect(dateKey).toBe(dailyDateKey());

    const res = await server.app.inject({
      method: "GET",
      url: `/api/daily/${dateKey}/leaderboard`,
    });
    const body = res.json() as DailyLeaderboardResponse;
    expect(body.totalPlayers).toBe(1);
    expect(body.totalWinners).toBe(0);
    expect(body.winners).toEqual([]);
  });
});
