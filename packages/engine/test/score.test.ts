import { describe, expect, it } from "vitest";
import { emptySheet } from "../src/types.js";
import { scoreSheet, triangular } from "../src/score.js";
import { sheetWithCrosses } from "./helpers.js";

describe("triangular", () => {
  it("matches the published table (§8)", () => {
    const expected = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
    expected.forEach((pts, i) => {
      expect(triangular(i + 1)).toBe(pts);
    });
  });
});

describe("scoreSheet", () => {
  it("scores an empty sheet as zero", () => {
    const sheet = emptySheet("p1");
    const result = scoreSheet(sheet);
    expect(result.total).toBe(0);
  });

  it("counts the lock as an extra mark: 5 crosses + terminal + lock = 7 marks = 28 pts", () => {
    const sheet = sheetWithCrosses("p1", "red", [2, 3, 4, 5, 6, 12]);
    expect(sheet.rows.red.locked).toBe(true);
    const result = scoreSheet(sheet);
    // 6 crossed indices + 1 lock mark = 7 marks
    expect(result.rowScores.red).toBe(triangular(7));
    expect(result.rowScores.red).toBe(28);
  });

  it("subtracts 5 points per penalty", () => {
    const sheet = emptySheet("p1");
    sheet.penalties = 3;
    const result = scoreSheet(sheet);
    expect(result.penaltyPoints).toBe(15);
    expect(result.total).toBe(-15);
  });

  it("sums all four rows minus penalties for a mixed sheet", () => {
    const sheet = emptySheet("p1");
    sheet.rows.red = sheetWithCrosses("p1", "red", [2, 3, 4]).rows.red; // 3 marks -> 6
    sheet.rows.yellow = sheetWithCrosses("p1", "yellow", [2]).rows.yellow; // 1 mark -> 1
    sheet.penalties = 1;
    const result = scoreSheet(sheet);
    expect(result.total).toBe(6 + 1 + 0 + 0 - 5);
  });
});
