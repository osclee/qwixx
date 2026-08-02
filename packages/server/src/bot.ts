import {
  indexOfValue,
  isLockAttempt,
  legalColorMoves,
  legalWhiteMoves,
  rowValues,
  triangular,
  type Color,
  type DiceRoll,
  type LegalColorMove,
  type LegalWhiteMove,
  type PlayerSheet,
} from "@quixx/engine";

export type BotDifficulty = "easy" | "medium" | "hard";

/**
 * Ranks legal moves the way a "medium" bot plays: always take a lock when
 * one is legally available (close to strictly good — extra point, denies
 * the die); otherwise prefer the move that skips the fewest cells in its
 * row, since skipping burns future scoring potential in that row for no
 * immediate benefit. Ties (including the lock case, when multiple rows
 * could lock) are broken by preferring the row with the most existing
 * crosses — its next mark is worth more points — and any remaining tie is
 * broken by `random`.
 */
function rankMedium<T extends { color: Color; value: number }>(
  moves: T[],
  sheet: PlayerSheet,
  random: () => number,
): T {
  const lockMoves = moves.filter((m) => isLockAttempt(m.color, m.value));
  const pool = lockMoves.length > 0 ? lockMoves : moves;

  let best: T[] = [];
  let bestSkip = Infinity;
  let bestCrossCount = -1;
  for (const move of pool) {
    const row = sheet.rows[move.color];
    // Non-null: these are already-legal moves, so the value always resolves to a cell.
    const index = indexOfValue(move.color, move.value) as number;
    const skip = index - row.lastCrossedIndex - 1;
    const crossCount = row.crossedIndices.length;
    if (skip < bestSkip || (skip === bestSkip && crossCount > bestCrossCount)) {
      best = [move];
      bestSkip = skip;
      bestCrossCount = crossCount;
    } else if (skip === bestSkip && crossCount === bestCrossCount) {
      best.push(move);
    }
  }
  return best[Math.floor(random() * best.length)] as T;
}

function pickUniform<T>(moves: T[], random: () => number): T {
  return moves[Math.floor(random() * moves.length)] as T;
}

// ---------- "hard": one-ply expectimax using exact dice probabilities ----------

/**
 * Rough estimate of how many more turns are worth discounting a skipped
 * cell's future odds against. Not derived from the live game state — this
 * is a one-ply heuristic, not a full lookahead — just a plausible ballpark
 * for a Qwixx game's remaining length. WHITE opportunities come every turn
 * (see below); COLOR opportunities only come on the bot's own active
 * turns, so they get divided down by seat count.
 */
const REMAINING_TURNS_ESTIMATE = 10;

/**
 * Extra weight for locking a row, on top of the real score it already
 * earns. Represents the value of denying that color die to the entire
 * table (every other seat loses access to it too) — something a per-row
 * score-only view can't see, since it only reasons about this one sheet.
 */
const LOCK_BONUS = 5;

/** P(sum of two independent d6 == k), k in 2..12. This is the exact WHITE-phase
 * distribution, and — since a COLOR-phase combo is also just two independent
 * d6 summed (one white die, one color die) — the same curve underlies a
 * single color combo's odds too (see COLOR_HIT_PROB below for the two-combos-
 * per-turn case). */
function twoDiceSumProb(k: number): number {
  return k >= 2 && k <= 12 ? (6 - Math.abs(k - 7)) / 36 : 0;
}

/**
 * P(at least one of the two white dice, each freshly summed with a fresh
 * color die, equals k) — the real per-turn odds of a usable COLOR combo for
 * value k next time the bot is active, since the color phase always offers
 * two combos (w1+color, w2+color) sharing the same color die. Computed once
 * by brute-force enumeration over all 216 equally likely (w1, w2, color)
 * outcomes — exact, not sampled.
 */
function buildColorHitProbTable(): number[] {
  const counts = new Array(13).fill(0);
  for (let w1 = 1; w1 <= 6; w1++) {
    for (let w2 = 1; w2 <= 6; w2++) {
      for (let c = 1; c <= 6; c++) {
        const hitValues = new Set([w1 + c, w2 + c]);
        for (const v of hitValues) counts[v] += 1;
      }
    }
  }
  return counts.map((n) => n / 216);
}
const COLOR_HIT_PROB = buildColorHitProbTable();

/**
 * One-ply expectimax move ranking: for each candidate move, weighs the
 * score it earns now against the expected value of every cell it
 * permanently skips over in that row (crosses only ever go left-to-right,
 * so a skipped cell can never be reached later). A skipped cell's cost is
 * its value if it were instead the very next mark taken in that row (all
 * skipped cells are hypothetically compared against the same current
 * mark-count, since none of them have actually been crossed), times the
 * probability it would come up again within a rough estimate of the bot's
 * remaining chances — using the row's own exact dice odds, not a flat
 * per-cell rule like medium's skip-count minimization. Locking gets an
 * extra flat bonus (see LOCK_BONUS) but is not an automatic override the
 * way it is for medium: in principle the math can still favor holding out.
 * If every legal move's skip cost outweighs its gain, returns null so the
 * caller passes instead — the one behavior easy/medium never do.
 */
function rankHard<T extends { color: Color; value: number }>(
  moves: T[],
  sheet: PlayerSheet,
  hitProb: (value: number) => number,
  remainingChances: number,
  random: () => number,
): T | null {
  let best: T[] = [];
  let bestScore = -Infinity;
  for (const move of moves) {
    const row = sheet.rows[move.color];
    // Non-null: these are already-legal moves, so the value always resolves to a cell.
    const index = indexOfValue(move.color, move.value) as number;
    const marksBefore = row.crossedIndices.length;
    const isLock = isLockAttempt(move.color, move.value);
    const marksAfter = marksBefore + 1 + (isLock ? 1 : 0);
    let score = triangular(marksAfter) - triangular(marksBefore);
    if (isLock) score += LOCK_BONUS;

    // Every skipped cell would be worth the same thing if it turned out to
    // be the next one reached instead (none of them have been crossed yet).
    const forfeitValuePerCell = marksBefore + 1;
    const values = rowValues(move.color);
    let forfeitCost = 0;
    for (let j = row.lastCrossedIndex + 1; j < index; j++) {
      const v = values[j] as number;
      const hitWithinHorizon = 1 - (1 - hitProb(v)) ** remainingChances;
      forfeitCost += hitWithinHorizon * forfeitValuePerCell;
    }
    score -= forfeitCost;

    if (score > bestScore) {
      best = [move];
      bestScore = score;
    } else if (score === bestScore) {
      best.push(move);
    }
  }

  if (bestScore < 0) return null; // even the best move is a net loss -- pass instead
  return best[Math.floor(random() * best.length)] as T;
}

function rankHardWhite<T extends { color: Color; value: number }>(
  moves: T[],
  sheet: PlayerSheet,
  random: () => number,
): T | null {
  return rankHard(moves, sheet, twoDiceSumProb, REMAINING_TURNS_ESTIMATE, random);
}

function rankHardColor<T extends { color: Color; value: number }>(
  moves: T[],
  sheet: PlayerSheet,
  seatCount: number,
  random: () => number,
): T | null {
  const remainingChances = Math.max(1, Math.round(REMAINING_TURNS_ESTIMATE / seatCount));
  return rankHard(moves, sheet, (v) => COLOR_HIT_PROB[v] ?? 0, remainingChances, random);
}

/** Picks a bot's WHITE-phase move, or null if none is legal or (hard only) worth taking. */
export function chooseWhiteMove(
  sheet: PlayerSheet,
  sumWhite: number,
  difficulty: BotDifficulty,
  random: () => number,
): LegalWhiteMove | null {
  const moves = legalWhiteMoves(sheet, sumWhite);
  if (moves.length === 0) return null;
  if (difficulty === "hard") return rankHardWhite(moves, sheet, random);
  if (difficulty === "medium") return rankMedium(moves, sheet, random);
  return pickUniform(moves, random);
}

/** Picks a bot's COLOR-phase move, or null if none is legal or (hard only) worth taking. */
export function chooseColorMove(
  sheet: PlayerSheet,
  roll: DiceRoll,
  diceInPlay: ReadonlySet<Color>,
  difficulty: BotDifficulty,
  random: () => number,
  seatCount: number,
): LegalColorMove | null {
  const moves = legalColorMoves(sheet, roll, diceInPlay);
  if (moves.length === 0) return null;
  if (difficulty === "hard") return rankHardColor(moves, sheet, seatCount, random);
  if (difficulty === "medium") return rankMedium(moves, sheet, random);
  return pickUniform(moves, random);
}
