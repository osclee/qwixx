import {
  activePlayerId,
  applyCross,
  canCross,
  createGame,
  endGameNow,
  hasAnyLegalColorMove,
  hasAnyLegalWhiteMove,
  IllegalMoveError,
  marksInRow,
  resolveTurn,
  rollDice as engineRollDice,
  rowScore,
  rowValues,
  type Color,
  type GameState,
} from "@quixx/engine";
import type {
  ColorActionInput,
  DiceRoll,
  Phase,
  PublicResult,
  PublicSheet,
  WhiteActionInput,
} from "../net/protocol";

/**
 * Drives a full Qwixx game entirely in the browser, no server/WebSocket
 * involved — for pass-and-play on one device. Reuses @quixx/engine's rule
 * primitives directly (the same ones the server calls) rather than
 * duplicating the phase machine's *rules*, but the phase machine itself is
 * simplified relative to packages/server/src/table.ts: no phase timers, no
 * bots, no connected/disconnected concept, no auto-roll, since every player
 * is physically present at the same device and there's nobody to time out.
 */

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

export interface LocalPlayerInfo {
  playerId: string;
  name: string;
}

export interface LocalSnapshot {
  phase: Phase;
  activePlayerId: string | null;
  diceInPlay: Color[];
  removedColors: Color[];
  roll: DiceRoll | null;
  sheets: PublicSheet[];
  turnSeq: number;
  results: PublicResult[] | null;
  whiteSubmitted: string[];
}

function localDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}

function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}

export class LocalGameStore {
  private players: LocalPlayerInfo[] = [];
  private state: GameState | null = null;
  private snapshot: LocalSnapshot | null = null;
  private listeners = new Set<() => void>();

  getSnapshot(): LocalSnapshot | null {
    return this.snapshot;
  }

  getPlayers(): LocalPlayerInfo[] {
    return this.players;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  nameOf(playerId: string): string {
    return (
      this.players.find((p) => p.playerId === playerId)?.name ?? playerId
    );
  }

  /** Starts a fresh game for the given player names (2-5), in a random seat order. */
  start(names: string[]): void {
    const trimmed = names.map((n) => n.trim()).filter((n) => n.length > 0);
    if (trimmed.length < MIN_PLAYERS || trimmed.length > MAX_PLAYERS) {
      throw new Error(
        `Local multiplayer supports ${MIN_PLAYERS}-${MAX_PLAYERS} players`,
      );
    }
    this.players = trimmed.map((name, i) => ({
      playerId: `local-${i}`,
      name,
    }));
    this.state = createGame(shuffle(this.players.map((p) => p.playerId)));
    this.publish();
  }

  /** Starts a new game with the same players (a rematch), reshuffling seats. */
  newGame(): void {
    if (this.players.length === 0) return;
    this.state = createGame(shuffle(this.players.map((p) => p.playerId)));
    this.publish();
  }

  /** Scores every sheet exactly as it stands and ends the game immediately. */
  endGame(): void {
    const state = this.state;
    if (!state) return;
    endGameNow(state);
    this.publish();
  }

  /** Leaves the game entirely, back to the local-setup screen. */
  exit(): void {
    this.players = [];
    this.state = null;
    this.snapshot = null;
    this.notify();
  }

  rollDice(): void {
    const state = this.state;
    if (!state || state.phase !== "ROLLING") return;
    state.roll = engineRollDice(state.diceInPlay, localDie);
    this.enterWhitePhase();
  }

  submitWhite(playerId: string, action: WhiteActionInput): void {
    const state = this.state;
    if (!state || state.phase !== "WHITE") return;
    if (!this.players.some((p) => p.playerId === playerId)) return;
    if (state.pendingWhite[playerId] !== undefined) return;

    if (action.kind === "cross") {
      const sheet = state.sheets[playerId];
      const roll = state.roll;
      if (!sheet || !roll) return;
      const sumWhite = roll.w1 + roll.w2;
      if (
        action.value !== sumWhite ||
        !canCross(sheet, action.color, action.value)
      ) {
        return;
      }
      applyCross(state, playerId, action.color, action.value);
      state.pendingWhite[playerId] = {
        type: "cross",
        color: action.color,
        value: action.value,
      };
    } else {
      state.pendingWhite[playerId] = { type: "pass" };
    }

    if (this.allHaveAnswered()) {
      this.closeWhitePhase();
    } else {
      this.publish();
    }
  }

  submitColor(action: ColorActionInput): void {
    const state = this.state;
    if (!state || state.phase !== "COLOR") return;
    const active = activePlayerId(state);

    if (action.kind === "cross") {
      const sheet = state.sheets[active];
      const roll = state.roll;
      if (!sheet || !roll) return;
      const dieValue = roll[action.whiteDie];
      const colorValue = roll[action.color];
      if (
        colorValue === undefined ||
        !state.diceInPlay.has(action.color) ||
        dieValue + colorValue !== action.value ||
        !canCross(sheet, action.color, action.value)
      ) {
        return;
      }
      this.closeColorPhase({ color: action.color, value: action.value });
    } else {
      this.closeColorPhase(null);
    }
  }

  private allHaveAnswered(): boolean {
    const state = this.requireState();
    return this.players.every(
      (p) => state.pendingWhite[p.playerId] !== undefined,
    );
  }

  private enterWhitePhase(): void {
    const state = this.requireState();
    state.phase = "WHITE";
    state.pendingWhite = {};
    const roll = state.roll;
    if (!roll) throw new Error("enterWhitePhase without a roll");
    const sumWhite = roll.w1 + roll.w2;

    for (const player of this.players) {
      const sheet = state.sheets[player.playerId];
      if (!sheet) continue;
      if (!hasAnyLegalWhiteMove(sheet, sumWhite)) {
        state.pendingWhite[player.playerId] = { type: "pass" };
      }
    }

    if (this.allHaveAnswered()) {
      this.closeWhitePhase();
      return;
    }
    this.publish();
  }

  private closeWhitePhase(): void {
    const state = this.requireState();
    if (state.phase !== "WHITE") return;
    this.enterColorPhase();
  }

  private enterColorPhase(): void {
    const state = this.requireState();
    state.phase = "COLOR";
    const active = activePlayerId(state);
    const sheet = state.sheets[active];
    const roll = state.roll;

    if (
      !roll ||
      !sheet ||
      !hasAnyLegalColorMove(sheet, roll, state.diceInPlay)
    ) {
      // Publish the COLOR-phase snapshot before immediately closing it, so
      // the UI briefly shows "nobody has a legal color move" rather than
      // jumping straight from WHITE to the next turn's ROLLING.
      this.publish();
      this.closeColorPhase(null);
      return;
    }

    this.publish();
  }

  private closeColorPhase(
    cross: { color: Color; value: number } | null,
  ): void {
    const state = this.requireState();
    if (state.phase !== "COLOR") return;

    if (cross) {
      const active = activePlayerId(state);
      try {
        applyCross(state, active, cross.color, cross.value);
      } catch (err) {
        if (!(err instanceof IllegalMoveError)) throw err;
      }
    }

    state.phase = "RESOLVE";
    resolveTurn(state);
    this.publish();
  }

  private requireState(): GameState {
    if (!this.state) throw new Error("No active local game");
    return this.state;
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    this.notify();
  }

  private buildSnapshot(): LocalSnapshot {
    const state = this.requireState();
    const sheets: PublicSheet[] = this.players.map((p) => {
      const sheet = state.sheets[p.playerId];
      const rows = (["red", "yellow", "green", "blue"] as const).reduce(
        (acc, color) => {
          const row = sheet?.rows[color];
          const values = rowValues(color);
          acc[color] = {
            crossedValues: row
              ? row.crossedIndices.map((i) => values[i] as number)
              : [],
            lastCrossedIndex: row?.lastCrossedIndex ?? -1,
            locked: row?.locked ?? false,
            marks: row ? marksInRow(row) : 0,
            score: row ? rowScore(row) : 0,
          };
          return acc;
        },
        {} as PublicSheet["rows"],
      );
      return {
        playerId: p.playerId,
        nickname: p.name,
        connected: true,
        isBot: false,
        rows,
        penalties: sheet?.penalties ?? 0,
      };
    });

    const results: PublicResult[] | null = state.results
      ? state.results.map((r) => ({
          playerId: r.playerId,
          nickname: this.nameOf(r.playerId),
          total: r.total,
          penaltyPoints: r.penaltyPoints,
          rowScores: r.rowScores,
          rank: r.rank,
        }))
      : null;

    return {
      phase: state.phase,
      activePlayerId: activePlayerId(state),
      diceInPlay: [...state.diceInPlay],
      removedColors: [...state.removedColors],
      roll: state.roll,
      sheets,
      turnSeq: state.turnSeq,
      results,
      whiteSubmitted: Object.keys(state.pendingWhite),
    };
  }
}

export const LOCAL_MIN_PLAYERS = MIN_PLAYERS;
export const LOCAL_MAX_PLAYERS = MAX_PLAYERS;
