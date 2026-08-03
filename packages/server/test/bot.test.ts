import {
  applyCross,
  emptySheet,
  type Color,
  type PlayerSheet,
} from "@quixx/engine";
import { describe, expect, it } from "vitest";
import { chooseColorMove, chooseWhiteMove } from "../src/bot.js";

/**
 * Builds a sheet by crossing a sequence of values per row through the real
 * applyCross, so every precondition is only ever reached via legal moves —
 * mirrors packages/engine/test/helpers.ts's sheetWithCrosses, extended to
 * cross multiple rows on the same sheet.
 */
function buildSheet(
  playerId: string,
  crosses: [Color, number[]][],
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
  for (const [color, values] of crosses) {
    for (const v of values) applyCross(fakeState, playerId, color, v);
  }
  return sheet;
}

describe("chooseWhiteMove", () => {
  it("returns null when no row has a legal move", () => {
    // Lock all four rows (5 crosses + terminal) so nothing is ever legal again.
    const sheet = buildSheet("p1", [
      ["red", [2, 3, 4, 5, 6, 12]],
      ["yellow", [2, 3, 4, 5, 6, 12]],
      ["green", [12, 11, 10, 9, 8, 2]],
      ["blue", [12, 11, 10, 9, 8, 2]],
    ]);
    expect(chooseWhiteMove(sheet, 7, "easy", () => 0)).toBeNull();
    expect(chooseWhiteMove(sheet, 7, "medium", () => 0)).toBeNull();
    expect(chooseWhiteMove(sheet, 7, "hard", () => 0)).toBeNull();
  });

  describe("easy", () => {
    it("picks uniformly according to the injected random", () => {
      const sheet = emptySheet("p1");
      // On a blank sheet, sumWhite=7 is legal on all four rows.
      const low = chooseWhiteMove(sheet, 7, "easy", () => 0);
      const high = chooseWhiteMove(sheet, 7, "easy", () => 0.999);
      expect(low).not.toBeNull();
      expect(high).not.toBeNull();
      expect(low!.color).not.toBe(high!.color); // first vs last of 4 candidates
    });
  });

  describe("medium", () => {
    it("prefers the move that skips the fewest cells", () => {
      const sheet = emptySheet("p1");
      // sumWhite=9: red/yellow (ascending) need index 7 -> skip 7; green/blue
      // (descending) need index 3 -> skip 3. Medium must pick green or blue.
      const move = chooseWhiteMove(sheet, 9, "medium", () => 0);
      expect(move).not.toBeNull();
      expect(["green", "blue"]).toContain(move!.color);
      expect(move!.value).toBe(9);
    });

    it("breaks an equal-skip tie by preferring the row with more existing crosses", () => {
      const sheet = buildSheet("p1", [
        ["red", [2, 3, 4, 5]], // lastCrossedIndex=3, 4 crosses
        ["green", [12, 11, 10, 9, 8, 7]], // lastCrossedIndex=5, 6 crosses
      ]);
      // sumWhite=6: red index=4 -> skip 4-3-1=0. green index=6 -> skip 6-5-1=0.
      // yellow/blue are blank -> much larger skip. Both red and green tie at
      // skip=0; green has more existing crosses (6 vs 4) so it should win.
      const move = chooseWhiteMove(sheet, 6, "medium", () => 0.999);
      expect(move).toEqual({ color: "green", value: 6 });
    });

    it("always takes a lock over a lower-skip alternative", () => {
      const sheet = buildSheet("p1", [
        ["red", [2, 3, 4, 5, 6]], // 5 crosses -> eligible to lock on 12
      ]);
      // sumWhite=12: red's 12 is the terminal/lock cell (skip=5). green/blue's
      // 12 is their very first cell (skip=0, not a lock). Medium must still
      // choose the lock despite the larger skip. (yellow is blank and can't
      // take 12 yet -- fewer than 5 prior crosses.)
      const move = chooseWhiteMove(sheet, 12, "medium", () => 0);
      expect(move).toEqual({ color: "red", value: 12 });
    });
  });

  describe("hard", () => {
    it("voluntarily passes when every legal move's skip cost outweighs its gain", () => {
      // A totally blank sheet on the single most common roll (7 — the mode
      // of 2d6). Every row would have to skip several decent-probability
      // early cells to reach it. Easy/medium always take *something* here;
      // hard is the only one that can recognize it isn't worth it and pass.
      const sheet = emptySheet("p1");
      expect(chooseWhiteMove(sheet, 7, "hard", () => 0)).toBeNull();
      // Contrast: easy/medium never voluntarily pass when a legal move exists.
      expect(chooseWhiteMove(sheet, 7, "medium", () => 0)).not.toBeNull();
      expect(chooseWhiteMove(sheet, 7, "easy", () => 0)).not.toBeNull();
    });

    it("declines an available lock when it's the only legal move and not worth it", () => {
      // Red has 5 crosses (2-6) so its 12 is a legal lock -- but reaching it
      // skips 7,8,9,10,11, several of which are fairly likely to reappear.
      // Green/blue are already fully locked and yellow's 12 is illegal (needs
      // 5 prior crosses it doesn't have), so this lock is the *only* legal
      // move for sumWhite=12 -- and hard still turns it down.
      const sheet = buildSheet("p1", [
        ["red", [2, 3, 4, 5, 6]],
        ["green", [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]],
        ["blue", [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]],
      ]);
      expect(chooseWhiteMove(sheet, 12, "hard", () => 0)).toBeNull();
      // Medium has no such judgment -- it always takes an available lock.
      expect(chooseWhiteMove(sheet, 12, "medium", () => 0)).toEqual({
        color: "red",
        value: 12,
      });
    });

    it("still takes a lock when reaching it doesn't skip anything", () => {
      const sheet = buildSheet("p1", [
        ["red", [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
      ]); // 10 crosses, nothing skipped to reach 12
      expect(chooseWhiteMove(sheet, 12, "hard", () => 0)).toEqual({
        color: "red",
        value: 12,
      });
    });

    it("prefers a smaller, cheap-to-reach value over a costlier skip elsewhere", () => {
      // sumWhite=2 is the rarest possible roll and lands on index 0 of a
      // blank ascending row -- zero skip, essentially free to take.
      const sheet = emptySheet("p1");
      const move = chooseWhiteMove(sheet, 2, "hard", () => 0);
      expect(move).toEqual({ color: "red", value: 2 });
    });
  });
});

describe("chooseColorMove", () => {
  it("returns null when no color combo is legal", () => {
    const sheet = buildSheet("p1", [
      ["red", [2, 3, 4, 5, 6, 12]],
      ["yellow", [2, 3, 4, 5, 6, 12]],
      ["green", [12, 11, 10, 9, 8, 2]],
      ["blue", [12, 11, 10, 9, 8, 2]],
    ]);
    const roll = { w1: 3, w2: 4, red: 2, yellow: 2, green: 2, blue: 2 };
    const diceInPlay = new Set<Color>(["red", "yellow", "green", "blue"]);
    expect(
      chooseColorMove(sheet, roll, diceInPlay, "medium", () => 0, 2),
    ).toBeNull();
  });

  it("applies the same skip-minimizing heuristic as white moves", () => {
    const sheet = emptySheet("p1");
    // Four combos are legal here: w1+red=9 (index 7, skip 7), w2+red=8
    // (index 6, skip 6), w1+green=10 (index 1, skip 1), w2+green=9 (index 3,
    // skip 3) -- on a blank sheet skip equals the index itself. The
    // smallest-skip combo is w1+green.
    const roll = { w1: 2, w2: 1, red: 7, green: 8 };
    const diceInPlay = new Set<Color>(["red", "green"]);
    const move = chooseColorMove(sheet, roll, diceInPlay, "medium", () => 0, 2);
    expect(move).toEqual({ whiteDie: "w1", color: "green", value: 10 });
  });

  describe("hard", () => {
    it("weighs color combos the same probability-aware way as white moves", () => {
      const sheet = emptySheet("p1");
      const roll = { w1: 2, w2: 1, red: 7, green: 8 };
      const diceInPlay = new Set<Color>(["red", "green"]);
      const move = chooseColorMove(sheet, roll, diceInPlay, "hard", () => 0, 2);
      expect(move).toEqual({ whiteDie: "w1", color: "green", value: 10 });
    });
  });
});
