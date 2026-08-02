import type { Color } from "./types.js";
import { ROW_LENGTH, TERMINAL_INDEX } from "./types.js";

/** The 11 legal values for each row, in play order (index 0..10). */
const ROW_VALUES: Record<Color, readonly number[]> = {
  red: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  yellow: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  green: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  blue: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
};

export function rowValues(color: Color): readonly number[] {
  return ROW_VALUES[color];
}

/** The value of the terminal (rightmost, lock-eligible) cell for a row. */
export function terminalValue(color: Color): number {
  // Non-null: ROW_VALUES rows are fixed-length 11 arrays and TERMINAL_INDEX (10) is always in range.
  return ROW_VALUES[color][TERMINAL_INDEX] as number;
}

/** Maps a die-sum value to its index within the row, or undefined if out of range. */
export function indexOfValue(color: Color, value: number): number | undefined {
  const values = ROW_VALUES[color];
  for (let i = 0; i < ROW_LENGTH; i++) {
    if (values[i] === value) return i;
  }
  return undefined;
}
