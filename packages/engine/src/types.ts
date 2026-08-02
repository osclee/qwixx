/**
 * Core Qwixx data model.
 *
 * Design note: every row is represented as a fixed 11-slot array of legal
 * values in play order (ascending for red/yellow, descending for
 * green/blue). Left-to-right legality then reduces to a single integer
 * comparison against `lastCrossedIndex` — see legal.ts.
 */

export type Color = "red" | "yellow" | "green" | "blue";

export const COLORS: readonly Color[] = ["red", "yellow", "green", "blue"];

export type WhiteDie = "w1" | "w2";

/** Index 10 (the 11th slot) is always the terminal / lock-eligible cell. */
export const TERMINAL_INDEX = 10;
export const ROW_LENGTH = 11;
export const MIN_CROSSES_FOR_TERMINAL = 5;

export interface RowState {
  /** Indices (0..10) crossed so far, in increasing order (i.e. crossing order). */
  crossedIndices: number[];
  /** Highest index crossed so far, or -1 if none. Enforces left-to-right (§5). */
  lastCrossedIndex: number;
  /** True once the terminal cell (index 10) plus lock mark have been taken. */
  locked: boolean;
}

export function emptyRow(): RowState {
  return { crossedIndices: [], lastCrossedIndex: -1, locked: false };
}

export interface PlayerSheet {
  playerId: string;
  rows: Record<Color, RowState>;
  /** 0..4. At 4 the game ends (§7a). */
  penalties: number;
}

export function emptySheet(playerId: string): PlayerSheet {
  return {
    playerId,
    rows: {
      red: emptyRow(),
      yellow: emptyRow(),
      green: emptyRow(),
      blue: emptyRow(),
    },
    penalties: 0,
  };
}

export type Phase = "ROLLING" | "WHITE" | "COLOR" | "RESOLVE" | "FINISHED";

/** One completed dice roll for the currently-in-play dice. */
export interface DiceRoll {
  w1: number;
  w2: number;
  red?: number;
  yellow?: number;
  green?: number;
  blue?: number;
}

/** A player's declared action during the WHITE phase. */
export type WhiteAction = { type: "cross"; color: Color; value: number } | { type: "pass" };

/** The active player's declared action during the COLOR phase. */
export type ColorAction =
  | { type: "cross"; whiteDie: WhiteDie; color: Color; value: number }
  | { type: "pass" };

export interface PlayerResult {
  playerId: string;
  rowScores: Record<Color, number>;
  penaltyPoints: number;
  total: number;
  rank: number; // 1 = winner; ties share a rank
}

export interface GameState {
  seatOrder: string[]; // playerId per seat, in turn order
  activeSeat: number; // index into seatOrder
  diceInPlay: Set<Color>;
  removedColors: Set<Color>;
  sheets: Record<string, PlayerSheet>;
  phase: Phase;
  roll: DiceRoll | null;
  /** Declared white actions this turn, keyed by playerId. Cleared each turn. */
  pendingWhite: Record<string, WhiteAction>;
  /** Count of cells crossed by each player this turn (white + color). Used for the penalty rule. */
  turnCrossCount: Record<string, number>;
  /** Monotonic turn counter; also doubles as a snapshot/version id. */
  turnSeq: number;
  finished: boolean;
  results: PlayerResult[] | null;
}

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalMoveError";
  }
}
