import { indexOfValue } from "./rows.js";
import type { Color, DiceRoll, PlayerSheet, WhiteDie } from "./types.js";
import { MIN_CROSSES_FOR_TERMINAL, TERMINAL_INDEX } from "./types.js";

/**
 * The single legality predicate for crossing `value` in `color` on `sheet`.
 * Used identically by the white-sum check, the color-combo check, and by
 * the client for optimistic highlighting — there is exactly one definition
 * of "legal" in the whole system.
 */
export function canCross(sheet: PlayerSheet, color: Color, value: number): boolean {
  const row = sheet.rows[color];
  if (row.locked) return false;

  const i = indexOfValue(color, value);
  if (i === undefined) return false;

  // Left-to-right (§5): only cells strictly right of the last crossed cell.
  if (i <= row.lastCrossedIndex) return false;

  // Terminal gate (§6): the terminal cell requires >=5 prior crosses in this row.
  if (i === TERMINAL_INDEX && row.crossedIndices.length < MIN_CROSSES_FOR_TERMINAL) {
    return false;
  }

  return true;
}

/** Whether crossing `value` in `color` would also earn the lock mark. */
export function isLockAttempt(color: Color, value: number): boolean {
  return indexOfValue(color, value) === TERMINAL_INDEX;
}

export interface LegalWhiteMove {
  color: Color;
  value: number;
}

/** All rows (any color) in which `sumWhite` is currently a legal cross for this sheet. */
export function legalWhiteMoves(sheet: PlayerSheet, sumWhite: number): LegalWhiteMove[] {
  const moves: LegalWhiteMove[] = [];
  for (const color of ["red", "yellow", "green", "blue"] as const) {
    if (canCross(sheet, color, sumWhite)) {
      moves.push({ color, value: sumWhite });
    }
  }
  return moves;
}

export interface LegalColorMove {
  whiteDie: WhiteDie;
  color: Color;
  value: number;
}

function colorDieValue(color: Color, roll: DiceRoll): number | undefined {
  return roll[color];
}

/**
 * All legal color-combo moves for the active player: one in-play color die
 * plus one white die, for each in-play color. Deduplicated so that when
 * w1 === w2 the two combos (which land on the same cell) aren't reported
 * twice.
 */
export function legalColorMoves(
  sheet: PlayerSheet,
  roll: DiceRoll,
  diceInPlay: ReadonlySet<Color>,
): LegalColorMove[] {
  const moves: LegalColorMove[] = [];
  const seen = new Set<string>();

  for (const color of diceInPlay) {
    const colorValue = colorDieValue(color, roll);
    if (colorValue === undefined) continue;

    for (const whiteDie of ["w1", "w2"] as const) {
      const value = roll[whiteDie] + colorValue;
      const key = `${color}:${value}`;
      if (seen.has(key)) continue;
      if (canCross(sheet, color, value)) {
        moves.push({ whiteDie, color, value });
        seen.add(key);
      }
    }
  }

  return moves;
}

/** Used for the "no legal move existed" penalty path (§4.4) and to auto-pass players. */
export function hasAnyLegalWhiteMove(sheet: PlayerSheet, sumWhite: number): boolean {
  return legalWhiteMoves(sheet, sumWhite).length > 0;
}

export function hasAnyLegalColorMove(
  sheet: PlayerSheet,
  roll: DiceRoll,
  diceInPlay: ReadonlySet<Color>,
): boolean {
  return legalColorMoves(sheet, roll, diceInPlay).length > 0;
}
