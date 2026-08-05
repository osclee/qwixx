/**
 * Browser-storage layer for the Daily Challenge. Follows the `quixx.*`
 * localStorage convention established in session.ts. There is no server
 * account system in this app, so "one attempt per day" and the score
 * history are both purely client-side — clearing storage (or using another
 * browser) resets them. Acceptable for a casual, no-accounts daily puzzle.
 */

import type { Color } from "./protocol";

const HISTORY_KEY = "quixx.daily.history";
const MAX_HISTORY_ENTRIES = 365;

export interface DailyHistoryRow {
  crossedValues: number[];
  locked: boolean;
}

export interface DailyHistoryEntry {
  dateKey: string; // UTC "YYYY-MM-DD"
  won: boolean;
  /** Number of the player's own turns it took to win; null for a loss. */
  playerTurns: number | null;
  playedAt: number; // epoch ms, when the result was recorded
  /** The player's own final sheet — kept so the share text can be rebuilt later (e.g. from the lobby, after the game-over screen is gone). */
  rows: Record<Color, DailyHistoryRow>;
  penalties: number;
}

/** Today's UTC date key — matches the server's `dailyDateKey` (packages/server/src/daily.ts). */
export function todayDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getDailyHistory(): DailyHistoryEntry[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DailyHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Records (or overwrites) the result for a given day, keeping history sorted newest-first. */
export function saveDailyResult(entry: DailyHistoryEntry): void {
  const existing = getDailyHistory().filter((e) => e.dateKey !== entry.dateKey);
  const updated = [entry, ...existing]
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
    .slice(0, MAX_HISTORY_ENTRIES);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export function getTodayResult(
  dateKey: string = todayDateKey(),
): DailyHistoryEntry | null {
  return getDailyHistory().find((e) => e.dateKey === dateKey) ?? null;
}

/** Milliseconds until the next UTC midnight — for a "new challenge in Xh Ym" countdown. */
export function msUntilNextUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return next - now.getTime();
}
