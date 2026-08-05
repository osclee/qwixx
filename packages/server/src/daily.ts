import { seededDie, seededRandom, type FullDiceRoll } from "@quixx/engine";

/**
 * How many turns' worth of rolls to pre-generate. A 2-player Qwixx game
 * realistically ends well under 60 total turns (4 penalties or 2 colors
 * removed end it); this leaves generous headroom so `performRoll` never
 * needs its last-entry fallback in practice.
 */
const ROLL_SCHEDULE_LENGTH = 150;

/**
 * XORed into the roll-schedule seed to derive the bot's tie-break seed, so
 * the two seeded streams (dice values vs. bot move tie-breaking) never
 * overlap despite coming from the same day.
 */
const BOT_SEED_SALT = 0x9e3779b9;

/** UTC calendar date key, e.g. "2026-08-05" — the identity of "today's" challenge. */
export function dailyDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Deterministic 32-bit hash of the date key (FNV-1a), used to seed the
 * day's roll schedule and bot randomness. Same date string always yields
 * the same seed, for every player, forever.
 */
export function dailySeed(dateKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Pre-generates a full 6-face roll for every turn index up front, so a
 * turn's roll is a fixed constant looked up by turn number rather than a
 * value drawn from a live stream (see `presetRoll` in @quixx/engine for why
 * that distinction matters for determinism).
 */
export function buildDailyRollSchedule(
  seed: number,
  turns: number = ROLL_SCHEDULE_LENGTH,
): FullDiceRoll[] {
  const rollOne = seededDie(seed);
  const schedule: FullDiceRoll[] = [];
  for (let i = 0; i < turns; i++) {
    schedule.push({
      w1: rollOne(),
      w2: rollOne(),
      red: rollOne(),
      yellow: rollOne(),
      green: rollOne(),
      blue: rollOne(),
    });
  }
  return schedule;
}

export interface DailyConfig {
  dateKey: string;
  rollSchedule: FullDiceRoll[];
  botRandom: () => number;
}

/** Builds the full deterministic configuration for "today's" (UTC) daily challenge. */
export function getDailyConfig(now: Date = new Date()): DailyConfig {
  const dateKey = dailyDateKey(now);
  const seed = dailySeed(dateKey);
  return {
    dateKey,
    rollSchedule: buildDailyRollSchedule(seed),
    botRandom: seededRandom((seed ^ BOT_SEED_SALT) >>> 0),
  };
}
