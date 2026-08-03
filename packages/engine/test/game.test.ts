import { describe, expect, it } from "vitest";
import { createGame } from "../src/game.js";
import { applyCross, resolveTurn, activePlayerId } from "../src/apply.js";
import { legalColorMoves, legalWhiteMoves } from "../src/legal.js";
import { rollDice, seededDie } from "../src/dice.js";
import { scoreSheet } from "../src/score.js";
import { COLORS } from "../src/types.js";

/**
 * Drives a full game end-to-end with a deterministic "always take the first
 * legal move, preferring red > yellow > green > blue" policy for every
 * player. This isn't meant to model good play — it's an integration check
 * that the whole turn loop (roll -> white for everyone -> color for the
 * active player -> resolve) runs to a legitimate finish without the engine
 * ever throwing, deadlocking, or violating its own invariants.
 */
function playFullGame(seed: number, playerCount: number) {
  const players = Array.from({ length: playerCount }, (_, i) => `p${i}`);
  const state = createGame(players);
  const die = seededDie(seed);

  const MAX_TURNS = 2000;
  let turns = 0;

  while (!state.finished && turns < MAX_TURNS) {
    turns += 1;
    state.roll = rollDice(state.diceInPlay, die);
    const sumWhite = state.roll.w1 + state.roll.w2;

    // Action 1: every player, independently, greedily takes the white sum if legal.
    for (const playerId of state.seatOrder) {
      const sheet = state.sheets[playerId];
      if (!sheet) continue;
      const moves = legalWhiteMoves(sheet, sumWhite);
      if (moves.length > 0) {
        const move = moves[0];
        if (move) applyCross(state, playerId, move.color, move.value);
      }
    }

    // Action 2: active player greedily takes the first legal color combo.
    const active = activePlayerId(state);
    const activeSheet = state.sheets[active];
    if (activeSheet) {
      const colorMoves = legalColorMoves(
        activeSheet,
        state.roll,
        state.diceInPlay,
      );
      if (colorMoves.length > 0) {
        const move = colorMoves[0];
        if (move) applyCross(state, active, move.color, move.value);
      }
    }

    resolveTurn(state);
  }

  return { state, turns };
}

describe("full game replay (integration)", () => {
  it("reaches a legitimate finish within a bounded number of turns, for several seeds and player counts", () => {
    for (const playerCount of [2, 3, 4, 5]) {
      for (const seed of [1, 2, 3, 99]) {
        const { state, turns } = playFullGame(seed, playerCount);

        expect(state.finished).toBe(true);
        expect(turns).toBeLessThan(2000);
        expect(state.results).not.toBeNull();
        expect(state.results).toHaveLength(playerCount);

        // End condition actually holds (§7).
        const anyMaxed = Object.values(state.sheets).some(
          (s) => s.penalties >= 4,
        );
        expect(anyMaxed || state.removedColors.size >= 2).toBe(true);

        // Invariants on every sheet.
        for (const playerId of state.seatOrder) {
          const sheet = state.sheets[playerId];
          expect(sheet).toBeDefined();
          if (!sheet) continue;
          expect(sheet.penalties).toBeGreaterThanOrEqual(0);
          expect(sheet.penalties).toBeLessThanOrEqual(4);
          for (const color of COLORS) {
            const row = sheet.rows[color];
            // At most 11 numbered cells, and indices strictly increasing.
            expect(row.crossedIndices.length).toBeLessThanOrEqual(11);
            const sorted = [...row.crossedIndices].sort((a, b) => a - b);
            expect(row.crossedIndices).toEqual(sorted);
            expect(new Set(row.crossedIndices).size).toBe(
              row.crossedIndices.length,
            );
            if (row.locked) {
              expect(row.crossedIndices).toContain(10);
            }
          }
        }

        // computeResults' totals agree with scoreSheet called directly (aggregation sanity).
        for (const result of state.results ?? []) {
          const sheet = state.sheets[result.playerId];
          expect(sheet).toBeDefined();
          if (!sheet) continue;
          const direct = scoreSheet(sheet);
          expect(result.total).toBe(direct.total);
        }

        // Rank 1 is (one of) the highest total; ranks are consistent with sorted totals.
        const results = state.results ?? [];
        const maxTotal = Math.max(...results.map((r) => r.total));
        for (const r of results) {
          if (r.total === maxTotal) expect(r.rank).toBe(1);
          if (r.rank === 1) expect(r.total).toBe(maxTotal);
        }
      }
    }
  });

  it("never removes more than the 4 colors, and never double-counts a locked color", () => {
    const { state } = playFullGame(7, 2);
    expect(state.removedColors.size).toBeLessThanOrEqual(4);
    expect(state.diceInPlay.size + state.removedColors.size).toBe(4);
  });
});
