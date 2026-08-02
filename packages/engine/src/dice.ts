import type { Color, DiceRoll } from "./types.js";

/**
 * Injected RNG so the engine stays deterministic and testable: the server
 * supplies a cryptographically-random source, tests supply a seeded one.
 * Must return an integer in [1, 6] inclusive.
 */
export type Die = () => number;

export function rollDice(diceInPlay: ReadonlySet<Color>, rollOne: Die): DiceRoll {
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
export function makeCryptoDie(nodeCrypto: { randomInt(min: number, max: number): number }): Die {
  return () => nodeCrypto.randomInt(1, 7);
}

/** Simple deterministic PRNG (mulberry32) for reproducible tests/replays. */
export function seededDie(seed: number): Die {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return 1 + Math.floor(f * 6);
  };
}
