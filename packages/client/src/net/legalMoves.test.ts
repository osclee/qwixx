import { describe, expect, it } from "vitest";
import { legalColorCombos, legalWhiteRows } from "./legalMoves";
import type { Color, PublicRowState, PublicSheet } from "./protocol";

function emptyRow(): PublicRowState {
  return { crossedValues: [], lastCrossedIndex: -1, locked: false, marks: 0, score: 0 };
}

function makeSheet(overrides: Partial<Record<Color, Partial<PublicRowState>>> = {}): PublicSheet {
  const colors: Color[] = ["red", "yellow", "green", "blue"];
  const rows = {} as Record<Color, PublicRowState>;
  for (const color of colors) {
    rows[color] = { ...emptyRow(), ...overrides[color] };
  }
  return {
    playerId: "p1",
    nickname: "Alice",
    connected: true,
    isBot: false,
    rows,
    penalties: 0,
  };
}

describe("legalWhiteRows", () => {
  it("with no locks and nothing crossed, the sum is legal on every row", () => {
    const sheet = makeSheet();
    expect(legalWhiteRows(sheet, 5)).toEqual(["red", "yellow", "green", "blue"]);
  });

  it("excludes a locked row even though the sum would otherwise be legal", () => {
    const sheet = makeSheet({ red: { locked: true } });
    expect(legalWhiteRows(sheet, 5)).toEqual(["yellow", "green", "blue"]);
  });

  it("returns nothing when the sum is legal nowhere", () => {
    const sheet = makeSheet({
      red: { lastCrossedIndex: 0 },
      yellow: { lastCrossedIndex: 0 },
      green: { locked: true },
      blue: { locked: true },
    });
    expect(legalWhiteRows(sheet, 2)).toEqual([]);
  });
});

describe("legalColorCombos", () => {
  it("finds a red combo from either white die when red is in play", () => {
    const sheet = makeSheet();
    const combos = legalColorCombos(sheet, { w1: 3, w2: 4, red: 6 }, ["red"]);
    expect(combos).toEqual(
      expect.arrayContaining([
        { whiteDie: "w1", color: "red", value: 9 },
        { whiteDie: "w2", color: "red", value: 10 },
      ]),
    );
  });

  it("omits colors that aren't currently in play", () => {
    const sheet = makeSheet();
    const combos = legalColorCombos(sheet, { w1: 3, w2: 4, red: 6, blue: 2 }, ["red"]);
    expect(combos.every((m) => m.color === "red")).toBe(true);
  });

  it("skips a locked row's color entirely", () => {
    const sheet = makeSheet({ red: { locked: true } });
    const combos = legalColorCombos(sheet, { w1: 3, w2: 4, red: 6 }, ["red"]);
    expect(combos).toEqual([]);
  });
});
