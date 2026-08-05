import type { StoredDailyResult } from "./store/index.js";
import type { DailyLeaderboardResponse } from "./protocol.js";

/**
 * Ranks a day's Daily Challenge attempts into the leaderboard wire shape.
 * Only wins are ranked (turns-to-win is meaningless for a loss); losses
 * still count toward `totalPlayers` so the "N played, M beat the bot"
 * framing has real numbers behind it. Ties (identical turn counts) share a
 * rank, same convention as the engine's own `computeResults` — broken only
 * for sort order (not rank) by who reached it first.
 */
export function buildDailyLeaderboardResponse(
  dateKey: string,
  entries: StoredDailyResult[],
): DailyLeaderboardResponse {
  const winners = entries
    .filter(
      (e): e is StoredDailyResult & { playerTurns: number } =>
        e.won && e.playerTurns !== null,
    )
    .sort((a, b) => a.playerTurns - b.playerTurns || a.playedAt - b.playedAt);

  let rank = 0;
  let lastTurns: number | null = null;
  let seen = 0;
  const ranked = winners.map((w) => {
    seen += 1;
    if (lastTurns === null || w.playerTurns !== lastTurns) {
      rank = seen;
      lastTurns = w.playerTurns;
    }
    return {
      rank,
      nickname: w.nickname,
      playerTurns: w.playerTurns,
      playedAt: w.playedAt,
    };
  });

  return {
    dateKey,
    winners: ranked,
    totalPlayers: entries.length,
    totalWinners: winners.length,
  };
}
