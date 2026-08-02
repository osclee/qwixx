import type { Color, PlayerSheet, RowState } from "./types.js";
import { COLORS } from "./types.js";

/** Triangular number: points(n) = n * (n + 1) / 2 (§8). */
export function triangular(n: number): number {
  return (n * (n + 1)) / 2;
}

/** Marks in a row = cells crossed, plus one extra mark if the lock was earned (§6, §8). */
export function marksInRow(row: RowState): number {
  return row.crossedIndices.length + (row.locked ? 1 : 0);
}

export function rowScore(row: RowState): number {
  return triangular(marksInRow(row));
}

export interface SheetScore {
  rowScores: Record<Color, number>;
  penaltyPoints: number;
  total: number;
}

export function scoreSheet(sheet: PlayerSheet): SheetScore {
  const rowScores = {} as Record<Color, number>;
  let rowTotal = 0;
  for (const color of COLORS) {
    const s = rowScore(sheet.rows[color]);
    rowScores[color] = s;
    rowTotal += s;
  }
  const penaltyPoints = 5 * sheet.penalties;
  return { rowScores, penaltyPoints, total: rowTotal - penaltyPoints };
}
