import type { StoredGameHistory } from "./store/index.js";
import type { GameHistoryResponse } from "./protocol.js";

/** Merges stored engine results (no nickname) with seat records into the wire response. */
export function buildHistoryResponse(
  history: StoredGameHistory,
): GameHistoryResponse {
  const nicknameOf = (playerId: string): string =>
    history.seats.find((s) => s.playerId === playerId)?.nickname ?? playerId;

  return {
    roomCode: history.roomCode,
    createdAt: history.createdAt,
    results: history.results.map((r) => ({
      playerId: r.playerId,
      nickname: nicknameOf(r.playerId),
      total: r.total,
      penaltyPoints: r.penaltyPoints,
      rowScores: r.rowScores,
      rank: r.rank,
    })),
  };
}
