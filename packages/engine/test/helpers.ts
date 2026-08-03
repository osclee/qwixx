import { emptySheet } from "../src/types.js";
import type { Color, PlayerSheet } from "../src/types.js";
import { applyCross } from "../src/apply.js";

/** Builds a sheet and cross a sequence of values in a row via the real applyCross,
 * so preconditions (e.g. "5 crosses already in red") are only ever built through
 * legal moves — never by poking crossedIndices directly. */
export function sheetWithCrosses(
  playerId: string,
  color: Color,
  values: number[],
): PlayerSheet {
  const sheet = emptySheet(playerId);
  const fakeState = {
    seatOrder: [playerId],
    activeSeat: 0,
    diceInPlay: new Set<Color>(),
    removedColors: new Set<Color>(),
    sheets: { [playerId]: sheet },
    phase: "WHITE" as const,
    roll: null,
    pendingWhite: {},
    turnCrossCount: {},
    turnSeq: 0,
    finished: false,
    results: null,
  };
  for (const v of values) {
    applyCross(fakeState, playerId, color, v);
  }
  return sheet;
}
