import type { DailyLeaderboardResponse } from "./protocol";

export async function fetchDailyLeaderboard(
  dateKey: string,
): Promise<DailyLeaderboardResponse> {
  const res = await fetch(`/api/daily/${encodeURIComponent(dateKey)}/leaderboard`);
  if (!res.ok) throw new Error("Failed to load today's leaderboard.");
  return res.json() as Promise<DailyLeaderboardResponse>;
}
