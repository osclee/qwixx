import type { Color, DiceRoll } from "./types.js";

/**
 * Injected RNG so the engine stays deterministic and testable: the server
 * supplies a cryptographically-random source, tests supply a seeded one.
 * Must return an integer in [1, 6] inclusive.
 */
export type Die = () => number;

export function rollDice(
  diceInPlay: ReadonlySet<Color>,
  rollOne: Die,
): DiceRoll {
  const roll: DiceRoll = { w1: rollOne(), w2: rollOne() };
  for (const color of ["red", "yellow", "green", "blue"] as const) {
    if (diceInPlay.has(color)) {
      roll[color] = rollOne();
    }
  }
  return roll;
}

/**
 * Uniform 1..6 backed by Node's crypto. Server-only: the client bundles this
 * same package for optimistic legal-move highlighting but never calls this
 * function, so the `node:crypto` import is done dynamically here to avoid
 * forcing a Node built-in into the browser bundle's static import graph.
 */
export async function cryptoDie(): Promise<number> {
  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.randomInt(1, 7);
}

/** Synchronous variant for callers (the server) that can top-level-await or pre-resolve the import. */
export function makeCryptoDie(nodeCrypto: {
  randomInt(min: number, max: number): number;
}): Die {
  return () => nodeCrypto.randomInt(1, 7);
}

/** Deterministic PRNG (mulberry32), returning a float in [0, 1) per call. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple deterministic PRNG for reproducible tests/replays. */
export function seededDie(seed: number): Die {
  const rand = mulberry32(seed);
  return () => 1 + Math.floor(rand() * 6);
}

/**
 * Same underlying generator as `seededDie`, but exposing the raw [0, 1)
 * stream instead of mapping it to a die face — for callers that need a
 * deterministic `Math.random`-shaped source (e.g. bot move tie-breaking).
 */
export function seededRandom(seed: number): () => number {
  return mulberry32(seed);
}

/** A fully-populated roll — every face present, unlike `DiceRoll` where color faces are optional. */
export type FullDiceRoll = Required<DiceRoll>;

/**
 * Fills in the colors currently in play from a precomputed full roll
 * (all six faces always present), instead of drawing fresh values. Used by
 * the daily challenge: a turn's roll must be a fixed constant looked up by
 * turn index, not derived by calling `rollOne` only for colors still in
 * play — that consumption pattern shifts (and thus changes future values)
 * depending on which rows have locked so far, which would make the "same
 * preset roll every time" guarantee depend on how the game was played.
 */
export function presetRoll(
  diceInPlay: ReadonlySet<Color>,
  full: FullDiceRoll,
): DiceRoll {
  const roll: DiceRoll = { w1: full.w1, w2: full.w2 };
  for (const color of ["red", "yellow", "green", "blue"] as const) {
    if (diceInPlay.has(color)) {
      roll[color] = full[color];
    }
  }
  return roll;
}
