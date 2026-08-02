import { COLORS } from "./types.js";
import type { GameState } from "./types.js";
import { emptySheet } from "./types.js";

/**
 * Builds a fresh GameState for a new game. `seatOrder` is the list of
 * playerIds in turn order; the caller (server) decides seat assignment and
 * the random starting player before calling this (§3) — this factory just
 * assembles blank sheets and starts at seat 0 of whatever order it's given.
 */
export function createGame(seatOrder: string[]): GameState {
  if (seatOrder.length < 2 || seatOrder.length > 5) {
    throw new Error(`Qwixx supports 2-5 players, got ${seatOrder.length}`);
  }

  const sheets: GameState["sheets"] = {};
  for (const playerId of seatOrder) {
    sheets[playerId] = emptySheet(playerId);
  }

  return {
    seatOrder: [...seatOrder],
    activeSeat: 0,
    diceInPlay: new Set(COLORS),
    removedColors: new Set(),
    sheets,
    phase: "ROLLING",
    roll: null,
    pendingWhite: {},
    turnCrossCount: {},
    turnSeq: 0,
    finished: false,
    results: null,
  };
}
