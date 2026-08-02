import {
  COLORS,
  legalColorMoves,
  legalWhiteMoves,
  type Color as EngineColor,
  type DiceRoll as EngineDiceRoll,
  type PlayerSheet,
  type RowState,
} from "@quixx/engine";
import type { Color, DiceRoll, PublicSheet } from "./protocol";

/**
 * Rebuilds just enough of the engine's PlayerSheet shape from the public,
 * wire-friendly sheet the server broadcasts. canCross only reads
 * `lastCrossedIndex`, `locked`, and `crossedIndices.length` (for the
 * terminal-cell gate) — never the actual indices — so a same-length filler
 * array is a faithful stand-in for the real crossedIndices.
 */
function toEngineSheet(sheet: PublicSheet): PlayerSheet {
  const rows = {} as Record<EngineColor, RowState>;
  for (const color of COLORS) {
    const row = sheet.rows[color];
    rows[color] = {
      crossedIndices: new Array(row.crossedValues.length).fill(0) as number[],
      lastCrossedIndex: row.lastCrossedIndex,
      locked: row.locked,
    };
  }
  return { playerId: sheet.playerId, rows, penalties: sheet.penalties };
}

/** Rows (any color) where crossing the white sum is currently legal for this sheet. */
export function legalWhiteRows(sheet: PublicSheet, sumWhite: number): Color[] {
  return legalWhiteMoves(toEngineSheet(sheet), sumWhite).map((m) => m.color);
}

export interface LegalColorCombo {
  whiteDie: "w1" | "w2";
  color: Color;
  value: number;
}

/** Legal color-combo moves for the active player's own sheet, given the current roll and dice in play. */
export function legalColorCombos(sheet: PublicSheet, roll: DiceRoll, diceInPlay: Color[]): LegalColorCombo[] {
  return legalColorMoves(toEngineSheet(sheet), roll as EngineDiceRoll, new Set(diceInPlay));
}
