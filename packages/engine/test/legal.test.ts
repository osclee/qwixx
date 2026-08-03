import { describe, expect, it } from "vitest";
import { emptySheet } from "../src/types.js";
import { canCross, legalColorMoves, legalWhiteMoves } from "../src/legal.js";
import { sheetWithCrosses } from "./helpers.js";

describe("left-to-right constraint (§5)", () => {
  it("allows skipping cells", () => {
    const sheet = emptySheet("p1");
    expect(canCross(sheet, "red", 7)).toBe(true); // skip 2,3,4,5,6
  });

  it("makes a skipped cell permanently dead once a later cell is crossed", () => {
    const sheet = sheetWithCrosses("p1", "red", [7]);
    expect(canCross(sheet, "red", 5)).toBe(false); // 5 is left of 7, now dead
    expect(canCross(sheet, "red", 8)).toBe(true); // still open to the right
  });

  it("applies independently per row on the same sheet", () => {
    const sheet = sheetWithCrosses("p1", "red", [7]);
    expect(canCross(sheet, "yellow", 5)).toBe(true);
  });

  it("green/blue descending rows use the same left-to-right logic in reverse numeric order", () => {
    const sheet = sheetWithCrosses("p1", "green", [10]); // index 2 (12,11,10,...)
    expect(canCross(sheet, "green", 11)).toBe(false); // numerically higher, but to the left
    expect(canCross(sheet, "green", 9)).toBe(true); // numerically lower, but to the right
  });
});

describe("terminal gate (§6)", () => {
  it("rejects the terminal value with fewer than 5 prior crosses", () => {
    const sheet = sheetWithCrosses("p1", "red", [2, 3, 4, 5]); // 4 crosses
    expect(canCross(sheet, "red", 12)).toBe(false);
  });

  it("accepts the terminal value at exactly 5 prior crosses", () => {
    const sheet = sheetWithCrosses("p1", "red", [2, 3, 4, 5, 6]); // 5 crosses
    expect(canCross(sheet, "red", 12)).toBe(true);
  });

  it("uses value 2 as the terminal cell for green/blue (descending rows)", () => {
    const sheet = sheetWithCrosses("p1", "green", [12, 11, 10, 9, 8]); // 5 crosses
    expect(canCross(sheet, "green", 2)).toBe(true);
    const shortSheet = sheetWithCrosses("p1", "green", [12, 11, 10, 9]); // 4 crosses
    expect(canCross(shortSheet, "green", 2)).toBe(false);
  });
});

describe("locked rows", () => {
  it("rejects any further cross once locked", () => {
    const sheet = sheetWithCrosses("p1", "red", [2, 3, 4, 5, 6, 12]); // locks on 12
    expect(sheet.rows.red.locked).toBe(true);
    expect(canCross(sheet, "red", 8)).toBe(false); // 8 was never crossed but row is locked
  });
});

describe("legalWhiteMoves", () => {
  it("reports every row where the sum is currently legal", () => {
    const sheet = emptySheet("p1");
    const moves = legalWhiteMoves(sheet, 7);
    expect(moves).toHaveLength(4);
    expect(moves.map((m) => m.color).sort()).toEqual([
      "blue",
      "green",
      "red",
      "yellow",
    ]);
  });

  it("excludes locked rows and rows where the value is left of last-crossed", () => {
    const sheet = sheetWithCrosses("p1", "red", [9]);
    const moves = legalWhiteMoves(sheet, 7);
    expect(moves.map((m) => m.color)).not.toContain("red");
  });
});

describe("legalColorMoves", () => {
  it("deduplicates combos when both white dice have the same value", () => {
    const sheet = emptySheet("p1");
    const roll = { w1: 3, w2: 3, red: 4 };
    const diceInPlay = new Set<"red" | "yellow" | "green" | "blue">(["red"]);
    const moves = legalColorMoves(sheet, roll, diceInPlay);
    // Both w1+red and w2+red = 7, on the same red row -> exactly one legal move
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ color: "red", value: 7 });
  });

  it("only offers colors that are still in play", () => {
    const sheet = emptySheet("p1");
    const roll = { w1: 1, w2: 2, red: 4, yellow: 5 };
    const diceInPlay = new Set<"red" | "yellow" | "green" | "blue">(["red"]);
    const moves = legalColorMoves(sheet, roll, diceInPlay);
    expect(moves.every((m) => m.color === "red")).toBe(true);
  });

  it("reports distinct moves for w1 and w2 when they differ", () => {
    const sheet = emptySheet("p1");
    const roll = { w1: 1, w2: 5, red: 4 }; // 1+4=5, 5+4=9
    const diceInPlay = new Set<"red" | "yellow" | "green" | "blue">(["red"]);
    const moves = legalColorMoves(sheet, roll, diceInPlay);
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.value).sort()).toEqual([5, 9]);
  });
});
