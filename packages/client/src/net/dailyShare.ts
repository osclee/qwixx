import type { Color } from "./protocol";

/**
 * Wordle-style shareable score text for a finished Daily Challenge: a
 * result headline plus one line per color, each a short progress summary
 * (crossed count out of 11, plus a lock icon if the row was locked). This
 * mirrors Wordle's spirit of "show the shape of your result, not the
 * answer" while keeping every line short — a full 11-cell emoji grid per
 * row wraps unpredictably in narrow chat-app message bubbles, which is
 * exactly the "distracting on small screens" problem this format avoids.
 */

const ROW_LENGTH = 11;
const ROW_EMOJI: Record<Color, string> = {
  red: "🟥",
  yellow: "🟨",
  green: "🟩",
  blue: "🟦",
};
const EMPTY = "⬜";
const LOCKED = "🔒";
const PENALTY_TAKEN = "❌";
const PENALTY_SLOTS = 4;
const COLORS: readonly Color[] = ["red", "yellow", "green", "blue"];

export interface DailyShareRow {
  crossedValues: number[];
  locked: boolean;
}

export interface DailyShareData {
  dateKey: string; // UTC "YYYY-MM-DD"
  won: boolean;
  playerTurns: number | null;
  score: number;
  rows: Record<Color, DailyShareRow>;
  penalties: number;
}

/** e.g. "🟥7/11🔒" — crossed count out of 11, plus a lock icon if the row was locked. */
function rowSummary(color: Color, row: DailyShareRow): string {
  return `${ROW_EMOJI[color]}${row.crossedValues.length}/${ROW_LENGTH}${row.locked ? LOCKED : ""}`;
}

export function buildShareText(data: DailyShareData, origin?: string): string {
  const headline = data.won
    ? `🏆 Beat the bot in ${data.playerTurns} turn${data.playerTurns === 1 ? "" : "s"}! (${data.score} pts)`
    : `💀 Lost to the bot (${data.score} pts)`;

  const lines = [
    `Qwixx Daily #${data.dateKey}`,
    headline,
    "",
    ...COLORS.map((c) => rowSummary(c, data.rows[c])),
    PENALTY_TAKEN.repeat(data.penalties) + EMPTY.repeat(PENALTY_SLOTS - data.penalties),
  ];
  if (origin) lines.push("", origin);
  return lines.join("\n");
}

/**
 * Copies text to the clipboard, preferring the modern async Clipboard API
 * and falling back to the legacy execCommand dance for non-secure contexts
 * or browsers without navigator.clipboard. Returns whether it succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy fallback below
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
