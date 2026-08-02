import type { Color } from "./net/protocol";

/** Display order of values per row, left to right — mirrors @quixx/engine's rows.ts. */
export const ROW_DISPLAY_VALUES: Record<Color, readonly number[]> = {
  red: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  yellow: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  green: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  blue: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
};

export const ROW_ORDER: readonly Color[] = ["red", "yellow", "green", "blue"];

export const ROW_LABEL: Record<Color, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
};
