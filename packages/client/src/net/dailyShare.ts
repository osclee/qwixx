import { rowValues } from "@quixx/engine";
import type { Color } from "./protocol";

/**
 * Wordle-style shareable score text for a finished Daily Challenge: a
 * result headline plus an emoji grid mirroring the player's own sheet
 * (mirrors Wordle's spirit of "show the shape of your result, not the
 * answer" — friends can compare grids without it spoiling the day's dice).
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
  rows: Record<Color, DailyShareRow>;
  penalties: number;
}

/** One row's 11-cell strip: a filled square per crossed value, 🔒 on the terminal cell if locked. */
function rowLine(color: Color, row: DailyShareRow): string {
  const values = rowValues(color);
  const crossed = new Set(row.crossedValues);
  let line = "";
  for (let i = 0; i < ROW_LENGTH; i++) {
    const isTerminal = i === ROW_LENGTH - 1;
    if (isTerminal && row.locked) {
      line += LOCKED;
    } else if (crossed.has(values[i] as number)) {
      line += ROW_EMOJI[color];
    } else {
      line += EMPTY;
    }
  }
  return line;
}

export function buildShareText(data: DailyShareData, origin?: string): string {
  const headline = data.won
    ? `🏆 Beat the bot in ${data.playerTurns} turn${data.playerTurns === 1 ? "" : "s"}!`
    : "💀 Lost to the bot";

  const lines = [
    `Qwixx Daily #${data.dateKey}`,
    headline,
    "",
    ...COLORS.map((c) => rowLine(c, data.rows[c])),
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
