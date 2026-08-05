import { describe, expect, it } from "vitest";
import {
  presetRoll,
  rollDice,
  seededDie,
  seededRandom,
  type FullDiceRoll,
} from "../src/dice.js";

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

describe("seededRandom", () => {
  it("produces floats in [0,1)", () => {
    const rand = seededRandom(456);
    for (let i = 0; i < 200; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = seededRandom(99);
    const b = seededRandom(99);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe("presetRoll", () => {
  const full: FullDiceRoll = {
    w1: 3,
    w2: 5,
    red: 1,
    yellow: 2,
    green: 4,
    blue: 6,
  };

  it("always keeps both white dice", () => {
    const roll = presetRoll(new Set(), full);
    expect(roll.w1).toBe(3);
    expect(roll.w2).toBe(5);
    expect(roll.red).toBeUndefined();
    expect(roll.yellow).toBeUndefined();
    expect(roll.green).toBeUndefined();
    expect(roll.blue).toBeUndefined();
  });

  it("only keeps colors currently in play, from the fixed values", () => {
    const roll = presetRoll(new Set(["red", "green"]), full);
    expect(roll.red).toBe(1);
    expect(roll.green).toBe(4);
    expect(roll.yellow).toBeUndefined();
    expect(roll.blue).toBeUndefined();
  });

  it("is independent of which colors were previously removed", () => {
    // Same fixed "full" roll for a turn always yields the same value for a
    // color that's still in play, regardless of what else was removed.
    const rollA = presetRoll(new Set(["red", "yellow", "green", "blue"]), full);
    const rollB = presetRoll(new Set(["red"]), full);
    expect(rollB.red).toBe(rollA.red);
  });
});
