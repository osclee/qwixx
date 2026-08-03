import { describe, expect, it } from "vitest";
import { rollDice, seededDie } from "../src/dice.js";

describe("rollDice", () => {
  it("always includes both white dice", () => {
    const roll = rollDice(new Set(), seededDie(1));
    expect(roll.w1).toBeGreaterThanOrEqual(1);
    expect(roll.w1).toBeLessThanOrEqual(6);
    expect(roll.w2).toBeGreaterThanOrEqual(1);
    expect(roll.w2).toBeLessThanOrEqual(6);
  });

  it("only rolls colors that are in play", () => {
    const roll = rollDice(new Set(["red", "green"]), seededDie(42));
    expect(roll.red).toBeDefined();
    expect(roll.green).toBeDefined();
    expect(roll.yellow).toBeUndefined();
    expect(roll.blue).toBeUndefined();
  });

  it("is deterministic for a given seed", () => {
    const rollA = rollDice(
      new Set(["red", "yellow", "green", "blue"]),
      seededDie(7),
    );
    const rollB = rollDice(
      new Set(["red", "yellow", "green", "blue"]),
      seededDie(7),
    );
    expect(rollA).toEqual(rollB);
  });
});

describe("seededDie", () => {
  it("produces only integers in [1,6]", () => {
    const die = seededDie(123);
    for (let i = 0; i < 200; i++) {
      const v = die();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});
