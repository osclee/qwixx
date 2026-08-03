import { canCross, hasAnyLegalWhiteMove } from "./legal.js";
import { indexOfValue } from "./rows.js";
import type { Color, GameState, PlayerResult, PlayerSheet } from "./types.js";
import { COLORS, IllegalMoveError, TERMINAL_INDEX } from "./types.js";
import { scoreSheet } from "./score.js";

/**
 * Mutates `state` in place: crosses `value` in `color` on the given
 * player's sheet, after asserting legality. Throws IllegalMoveError on any
 * violation rather than silently no-opping, so a bug or a spoofed client
 * message surfaces immediately instead of desyncing state.
 *
 * Locking a row here only sets `row.locked = true` on this sheet. The
 * shared dice pool (`state.diceInPlay` / `state.removedColors`) is
 * deliberately left untouched until `resolveTurn` — see module doc there.
 */
export function applyCross(
  state: GameState,
  playerId: string,
  color: Color,
  value: number,
): void {
  const sheet = state.sheets[playerId];
  if (!sheet) throw new IllegalMoveError(`Unknown player ${playerId}`);

  if (!canCross(sheet, color, value)) {
    throw new IllegalMoveError(
      `Illegal cross: player=${playerId} color=${color} value=${value}`,
    );
  }

  const row = sheet.rows[color];
  const i = indexOfValue(color, value);
  if (i === undefined) {
    // Unreachable: canCross already validated this, but keep the invariant explicit.
    throw new IllegalMoveError(`Value ${value} not on ${color} row`);
  }

  row.crossedIndices.push(i);
  row.lastCrossedIndex = i;
  state.turnCrossCount[playerId] = (state.turnCrossCount[playerId] ?? 0) + 1;

  if (i === TERMINAL_INDEX) {
    row.locked = true;
  }
}

export function activePlayerId(state: GameState): string {
  const id = state.seatOrder[state.activeSeat];
  if (id === undefined) throw new Error("activeSeat out of range");
  return id;
}

function lockedColorsAcrossAllSheets(state: GameState): Set<Color> {
  const locked = new Set<Color>();
  for (const sheet of Object.values(state.sheets)) {
    for (const color of COLORS) {
      if (sheet.rows[color].locked) locked.add(color);
    }
  }
  return locked;
}

export function computeResults(state: GameState): PlayerResult[] {
  const scored = state.seatOrder.map((playerId) => {
    const sheet = state.sheets[playerId] as PlayerSheet;
    const { rowScores, penaltyPoints, total } = scoreSheet(sheet);
    return { playerId, rowScores, penaltyPoints, total };
  });

  const sorted = [...scored].sort((a, b) => b.total - a.total);
  const results: PlayerResult[] = [];
  let rank = 0;
  let lastTotal: number | null = null;
  let seen = 0;
  for (const s of sorted) {
    seen += 1;
    if (lastTotal === null || s.total !== lastTotal) {
      rank = seen;
      lastTotal = s.total;
    }
    results.push({ ...s, rank });
  }
  // Return in seat order for stable client rendering; rank is what conveys placement.
  return state.seatOrder.map(
    (playerId) => results.find((r) => r.playerId === playerId) as PlayerResult,
  );
}

/**
 * Runs the end-of-turn sequence, in the exact order the rules require:
 *
 *   1. Penalty check for the active player only (§4.4) — zero crosses this
 *      turn, whether by choice or because no legal move existed.
 *   2. Dice removal (§6) — any color locked on *any* sheet during this turn
 *      (white phase or color phase) is now retired from the shared pool.
 *      This is intentionally deferred: a lock discovered during the WHITE
 *      phase does not remove that die until here, so the active player can
 *      still use it in the COLOR phase of the same turn.
 *   3. End check (§7) — 4 penalties for any player, or 2+ colors removed.
 *
 * Mutates `state` in place and leaves it either FINISHED (with `results`
 * populated) or advanced to the next active seat with `phase` reset to
 * ROLLING and per-turn scratch state cleared.
 */
export function resolveTurn(state: GameState): void {
  const active = activePlayerId(state);

  const activeSheet = state.sheets[active];
  if (!activeSheet) throw new Error(`No sheet for active player ${active}`);
  if ((state.turnCrossCount[active] ?? 0) === 0) {
    activeSheet.penalties += 1;
  }

  const lockedNow = lockedColorsAcrossAllSheets(state);
  for (const color of lockedNow) {
    state.removedColors.add(color);
  }
  state.diceInPlay = new Set(COLORS.filter((c) => !state.removedColors.has(c)));

  const anyPlayerMaxedPenalties = Object.values(state.sheets).some(
    (s) => s.penalties >= 4,
  );
  const twoColorsRemoved = state.removedColors.size >= 2;

  if (anyPlayerMaxedPenalties || twoColorsRemoved) {
    state.finished = true;
    state.phase = "FINISHED";
    state.results = computeResults(state);
    return;
  }

  state.activeSeat = (state.activeSeat + 1) % state.seatOrder.length;
  state.turnSeq += 1;

  state.phase = "ROLLING";
  state.roll = null;
  state.pendingWhite = {};
  state.turnCrossCount = {};
}

/**
 * Force-ends the game immediately regardless of phase or the normal end
 * conditions (4 penalties / 2 colors removed) — used when the host manually
 * ends the game early. Scores sheets exactly as they stand.
 */
export function endGameNow(state: GameState): void {
  state.finished = true;
  state.phase = "FINISHED";
  state.results = computeResults(state);
}

/** True if the given player has no legal white move for the current sum — used to auto-pass. */
export function mustAutoPassWhite(
  sheet: PlayerSheet,
  sumWhite: number,
): boolean {
  return !hasAnyLegalWhiteMove(sheet, sumWhite);
}
