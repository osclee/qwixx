import { randomInt, randomUUID } from "node:crypto";
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
  presetRoll,
  resolveTurn,
  rollDice,
  rowScore,
  type Color,
  type FullDiceRoll,
  type GameState,
} from "@quixx/engine";
import { chooseColorMove, chooseWhiteMove, type BotDifficulty } from "./bot.js";
import type {
  ChatMessage,
  DailyStatus,
  ErrorMessage,
  EventMessage,
  PublicResult,
  PublicSheet,
  ServerMessage,
  SnapshotMessage,
} from "./protocol.js";
import type { GameStore, StoredActiveTable } from "./store/index.js";
import {
  deserializeGameState,
  serializeGameState,
  type SerializedGameState,
} from "./serialize.js";

export type { BotDifficulty } from "./bot.js";

export interface OutSocket {
  send(data: string): void;
}

export interface Seat {
  playerId: string;
  nickname: string;
  connected: boolean;
  sessionToken: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
}

export type LobbyState = "LOBBY" | "IN_PROGRESS" | "FINISHED";

export interface TableDeps {
  store: GameStore;
  /** Injected so tests can use a seeded die instead of real randomness. */
  rollOne?: () => number;
  now?: () => number;
  rollPhaseMs?: number;
  whitePhaseMs?: number;
  colorPhaseMs?: number;
  onEmpty?: (roomCode: string) => void;
  /** Range for a bot's "thinking" delay before it acts. Injectable so tests can make bots near-instant. */
  botMoveDelayMs?: { min: number; max: number };
  /** Injected so tests can make bot move selection deterministic. Returns a value in [0, 1). */
  botRandom?: () => number;
  /**
   * When set, turns are dealt from this fixed schedule (indexed by
   * `state.turnSeq`) instead of drawn live from `rollOne` — used by the
   * daily challenge so every player sees the exact same roll on turn N
   * regardless of what either side has locked so far. See `presetRoll` in
   * @quixx/engine for why turn-indexed lookup (rather than feeding a seeded
   * die into `rollDice`) is what makes that guarantee hold.
   */
  presetRolls?: FullDiceRoll[];
}

/** Set via `configureDaily`; identifies a table as a daily-challenge game and who's who. */
interface DailyInfo {
  dateKey: string;
  humanPlayerId: string;
  botPlayerId: string;
}

const DEFAULT_ROLL_MS = 10_000;
const DEFAULT_WHITE_MS = 45_000;
const DEFAULT_COLOR_MS = 30_000;
const DEFAULT_BOT_DELAY_MS = { min: 500, max: 1500 };
const MAX_SEATS = 5;
const MIN_SEATS = 2;

function cryptoRollOne(): number {
  return randomInt(1, 7);
}

export class Table {
  readonly roomCode: string;
  private seats: Seat[] = [];
  private hostId: string | null = null;
  private lobby: LobbyState = "LOBBY";
  private state: GameState | null = null;
  private connections = new Map<string, OutSocket>();
  private phaseDeadline: number | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimers = new Set<ReturnType<typeof setTimeout>>();
  private eventLog: EventMessage[] = [];
  private chatLog: ChatMessage[] = [];
  private createdAt: number;
  /** True only immediately after Table.restore(), until the first player reconnects. */
  private awaitingFirstReconnectAfterRestore = false;

  private readonly store: GameStore;
  private readonly rollOne: () => number;
  private readonly now: () => number;
  private readonly rollPhaseMs: number;
  private readonly whitePhaseMs: number;
  private readonly colorPhaseMs: number;
  private readonly onEmpty: ((roomCode: string) => void) | undefined;
  private readonly botMoveDelayMs: { min: number; max: number };
  private readonly botRandom: () => number;
  private readonly presetRolls: FullDiceRoll[] | undefined;
  private daily: DailyInfo | null = null;

  constructor(roomCode: string, deps: TableDeps) {
    this.roomCode = roomCode;
    this.store = deps.store;
    this.rollOne = deps.rollOne ?? cryptoRollOne;
    this.now = deps.now ?? (() => Date.now());
    this.rollPhaseMs = deps.rollPhaseMs ?? DEFAULT_ROLL_MS;
    this.whitePhaseMs = deps.whitePhaseMs ?? DEFAULT_WHITE_MS;
    this.colorPhaseMs = deps.colorPhaseMs ?? DEFAULT_COLOR_MS;
    this.onEmpty = deps.onEmpty;
    this.botMoveDelayMs = deps.botMoveDelayMs ?? DEFAULT_BOT_DELAY_MS;
    this.botRandom = deps.botRandom ?? Math.random;
    this.presetRolls = deps.presetRolls;
    this.createdAt = this.now();
  }

  /**
   * Marks this table as a daily-challenge game. Host-agnostic and not part
   * of the public ws protocol — called once by the registry right after
   * seating the human and bot, before `startGame`.
   *
   * Known limitation: `daily` and `presetRolls` are in-memory only, not
   * part of `StoredTable` — a server restart mid-daily-attempt rehydrates
   * the table as a normal (non-daily) game with live crypto dice instead of
   * preserving the preset schedule. Acceptable for a short single-player
   * session; not worth a store-schema migration for this edge case.
   */
  configureDaily(
    dateKey: string,
    humanPlayerId: string,
    botPlayerId: string,
  ): void {
    this.daily = { dateKey, humanPlayerId, botPlayerId };
  }

  // ---------- Seats / lobby ----------

  get hostPlayerId(): string | null {
    return this.hostId;
  }

  get lobbyState(): LobbyState {
    return this.lobby;
  }

  get seatCount(): number {
    return this.seats.length;
  }

  hasSeat(playerId: string): boolean {
    return this.seats.some((s) => s.playerId === playerId);
  }

  /** Adds a new seat. Only valid pre-game. Returns false if full or already started. */
  addSeat(playerId: string, nickname: string, sessionToken: string): boolean {
    if (this.lobby !== "LOBBY") return false;
    if (this.seats.length >= MAX_SEATS) return false;
    if (this.hasSeat(playerId)) return true;

    this.seats.push({
      playerId,
      nickname,
      connected: true,
      sessionToken,
      isBot: false,
      botDifficulty: null,
    });
    if (this.hostId === null) this.hostId = playerId;
    this.persistTableMeta();
    // Notify everyone already at the table — the new seat's own socket isn't
    // attached yet at this point (that happens right after, via
    // attachConnection), so broadcastSnapshot simply skips them for now.
    this.broadcastSnapshot();
    return true;
  }

  /**
   * Adds a CPU-controlled seat. Host-only, lobby-only, same capacity limit
   * as a human seat. Bots are always `connected: true` (there's no socket to
   * ever attach) so they're never treated as absent by the phase barriers —
   * their turns are driven by the bot scheduler in the turn-phase methods
   * below via the same submitRoll/submitWhite/submitColor entry points a
   * human's ws.ts handler calls.
   */
  addBotSeat(
    requesterId: string,
    difficulty: BotDifficulty,
  ): { ok: true; playerId: string } | { ok: false; error: string } {
    if (this.lobby !== "LOBBY")
      return { ok: false, error: "Game already started" };
    if (requesterId !== this.hostId)
      return { ok: false, error: "Only the host can add a bot" };
    if (this.seats.length >= MAX_SEATS)
      return { ok: false, error: "Table is full" };

    const botNumber = this.seats.filter((s) => s.isBot).length + 1;
    const difficultyLabel =
      difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    const playerId = randomUUID();
    this.seats.push({
      playerId,
      nickname: `CPU ${botNumber} (${difficultyLabel})`,
      connected: true,
      sessionToken: randomUUID(),
      isBot: true,
      botDifficulty: difficulty,
    });
    this.persistTableMeta();
    this.broadcastSnapshot();
    return { ok: true, playerId };
  }

  /** Removes a bot seat. Host-only, lobby-only, and only ever targets a bot seat (never a human). */
  removeBotSeat(
    requesterId: string,
    botPlayerId: string,
  ): { ok: true } | { ok: false; error: string } {
    if (this.lobby !== "LOBBY")
      return { ok: false, error: "Game already started" };
    if (requesterId !== this.hostId)
      return { ok: false, error: "Only the host can remove a bot" };
    const seat = this.seats.find((s) => s.playerId === botPlayerId);
    if (!seat || !seat.isBot) return { ok: false, error: "No such bot" };

    this.seats = this.seats.filter((s) => s.playerId !== botPlayerId);
    this.connections.delete(botPlayerId);
    this.persistTableMeta();
    this.broadcastSnapshot();
    return { ok: true };
  }

  /** All (playerId, sessionToken) pairs, used to rebuild the registry's session map after a restart. */
  listSessions(): { playerId: string; sessionToken: string }[] {
    return this.seats.map((s) => ({
      playerId: s.playerId,
      sessionToken: s.sessionToken,
    }));
  }

  /** Explicit leave request while still in the lobby: frees the seat entirely. */
  leaveLobby(playerId: string): void {
    if (this.lobby !== "LOBBY") return;
    this.seats = this.seats.filter((s) => s.playerId !== playerId);
    this.connections.delete(playerId);
    if (this.hostId === playerId) {
      // A bot can never be host (it can't call start_game), so skip past any
      // bot seats when picking the next host.
      this.hostId = this.seats.find((s) => !s.isBot)?.playerId ?? null;
    }
    if (this.seats.length === 0) this.onEmpty?.(this.roomCode);
    else {
      this.persistTableMeta();
      this.broadcastSnapshot();
    }
  }

  attachConnection(playerId: string, socket: OutSocket): void {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat) return;
    seat.connected = true;
    this.connections.set(playerId, socket);
    this.sendTo(playerId, this.buildSnapshot(playerId));
    for (const evt of this.eventLog.slice(-20)) this.sendTo(playerId, evt);
    for (const chat of this.chatLog.slice(-20)) this.sendTo(playerId, chat);

    // A restored table is deliberately left paused (see Table.restore) so it
    // doesn't auto-cascade through empty-seat turns before anyone comes
    // back. The first reconnect is what actually resumes the turn loop.
    if (this.awaitingFirstReconnectAfterRestore) {
      this.awaitingFirstReconnectAfterRestore = false;
      this.beginRoll();
    }
  }

  detachConnection(playerId: string): void {
    this.connections.delete(playerId);
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (seat) seat.connected = false;
    // A disconnect can itself be the thing a phase barrier was waiting on —
    // don't just leave it to the timer. If everyone still connected has
    // now answered, or the disconnecting player was the active player
    // stuck in COLOR, resolve immediately.
    this.recheckBarrierAfterDisconnect(playerId);
  }

  private recheckBarrierAfterDisconnect(playerId: string): void {
    const state = this.state;
    if (!state) return;
    if (state.phase === "ROLLING" && activePlayerId(state) === playerId) {
      this.performRoll();
    } else if (state.phase === "WHITE" && this.allConnectedHaveAnswered()) {
      this.closeWhitePhase();
    } else if (state.phase === "COLOR" && activePlayerId(state) === playerId) {
      this.closeColorPhase(null);
    }
  }

  private connectedSeats(): Seat[] {
    return this.seats.filter((s) => s.connected);
  }

  // ---------- Game start ----------

  /**
   * `opts.order`, when given, must be exactly the current seats' playerIds
   * (any permutation) and is used verbatim as turn order instead of the
   * usual random shuffle — used by the daily challenge to force the bot to
   * go first (its "advantaged position") rather than leaving it to chance.
   */
  startGame(
    requesterId: string,
    opts?: { order?: string[] },
  ): { ok: true } | { ok: false; error: string } {
    if (this.lobby !== "LOBBY")
      return { ok: false, error: "Game already started" };
    if (requesterId !== this.hostId)
      return { ok: false, error: "Only the host can start the game" };
    if (this.seats.length < MIN_SEATS) {
      return { ok: false, error: `Need at least ${MIN_SEATS} players` };
    }

    const seatIds = this.seats.map((s) => s.playerId);
    const fixedOrder =
      opts?.order &&
      opts.order.length === seatIds.length &&
      seatIds.every((id) => opts.order?.includes(id))
        ? opts.order
        : null;
    const order = fixedOrder ?? shuffle(seatIds, this.rollOne);
    this.state = createGame(order);
    this.lobby = "IN_PROGRESS";
    this.logEvent(
      `Game started. ${this.nicknameOf(order[0] as string)} goes first.`,
    );
    this.beginRoll();
    return { ok: true };
  }

  /**
   * Sends a finished table back to the lobby, with the same seats, so the
   * host can start a fresh game (reusing startGame/WaitingRoom entirely —
   * clients route off `lobbyState`, so flipping it back to LOBBY is all
   * that's needed for everyone to land back on the waiting-room UI).
   *
   * Known limitation: this doesn't clear the finished game's row in the
   * store, so a server restart in the narrow window between "game over"
   * and "host starts the next one" won't restore this table — the same
   * limitation a table that's never been started has. Not worth the extra
   * store-schema churn for that window.
   */
  newGame(requesterId: string): { ok: true } | { ok: false; error: string } {
    if (this.lobby !== "FINISHED")
      return { ok: false, error: "Game is not over" };
    if (requesterId !== this.hostId)
      return { ok: false, error: "Only the host can start a new game" };

    this.clearTimer();
    this.state = null;
    this.lobby = "LOBBY";
    this.phaseDeadline = null;
    this.logEvent("Host started a new game.");
    this.broadcastSnapshot();
    return { ok: true };
  }

  /**
   * Lets the host cut a game short — scores every sheet exactly as it
   * stands right now and moves straight to FINISHED, same as hitting one of
   * the normal end conditions. Reuses resolveAndContinue's persistence path
   * so a server restart mid-way doesn't strand the table half-finished.
   */
  endGame(requesterId: string): { ok: true } | { ok: false; error: string } {
    if (this.lobby !== "IN_PROGRESS")
      return { ok: false, error: "Game is not in progress" };
    if (requesterId !== this.hostId)
      return { ok: false, error: "Only the host can end the game" };

    this.clearTimer();
    const state = this.requireState();
    endGameNow(state);
    this.lobby = "FINISHED";
    this.phaseDeadline = null;
    this.store.saveSnapshot(
      this.roomCode,
      state.turnSeq,
      JSON.stringify(serializeGameState(state)),
    );
    this.store.saveResults(this.roomCode, JSON.stringify(state.results));
    this.recordDailyResultIfApplicable();
    this.logEvent(`${this.nicknameOf(requesterId)} ended the game.`);
    this.broadcastSnapshot();
    return { ok: true };
  }

  private nicknameOf(playerId: string): string {
    return (
      this.seats.find((s) => s.playerId === playerId)?.nickname ?? playerId
    );
  }

  // ---------- Chat ----------

  /** Broadcasts a chat message to everyone connected. Any seated player may chat, at any lobby state. */
  sendChat(
    playerId: string,
    text: string,
  ): { ok: true } | { ok: false; error: string } {
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat) return { ok: false, error: "Not seated at this table" };
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Message is empty" };

    const msg: ChatMessage = {
      type: "chat_broadcast",
      playerId,
      nickname: seat.nickname,
      text: trimmed,
      at: this.now(),
    };
    this.chatLog.push(msg);
    this.broadcast(msg);
    return { ok: true };
  }

  // ---------- Turn phase machine ----------

  /**
   * Enters the ROLLING phase and waits for the active player to roll —
   * giving them a beat to actually click "Roll" rather than dice just
   * appearing. Auto-rolls after `rollPhaseMs` (or immediately if the active
   * player isn't even connected) so a slow or absent player never stalls
   * the table; nobody loses their turn over it, this only gates the roll
   * itself.
   */
  private beginRoll(): void {
    this.clearBotTimers();
    const state = this.requireState();
    state.phase = "ROLLING";
    state.roll = null;

    const active = activePlayerId(state);
    const seat = this.seats.find((s) => s.playerId === active);
    if (!seat?.connected) {
      this.performRoll();
      return;
    }
    if (seat.isBot) {
      this.phaseDeadline = null;
      this.scheduleBotMove(() => this.performRoll());
      this.broadcastSnapshot();
      return;
    }

    this.clearTimer();
    this.phaseDeadline = this.now() + this.rollPhaseMs;
    this.phaseTimer = setTimeout(() => this.performRoll(), this.rollPhaseMs);
    this.broadcastSnapshot();
  }

  private performRoll(): void {
    this.clearTimer();
    const state = this.requireState();
    if (state.phase !== "ROLLING") return; // already rolled (race between click and timer)
    if (this.presetRolls) {
      const entry =
        this.presetRolls[state.turnSeq] ??
        (this.presetRolls[this.presetRolls.length - 1] as FullDiceRoll);
      state.roll = presetRoll(state.diceInPlay, entry);
    } else {
      state.roll = rollDice(state.diceInPlay, this.rollOne);
    }
    this.enterWhitePhase();
  }

  submitRoll(playerId: string): { ok: true } | { ok: false; error: string } {
    const state = this.requireStateOrNull();
    if (!state || state.phase !== "ROLLING")
      return { ok: false, error: "Not waiting to roll" };
    if (playerId !== activePlayerId(state))
      return { ok: false, error: "Only the active player may roll" };
    this.performRoll();
    return { ok: true };
  }

  private enterWhitePhase(): void {
    this.clearBotTimers();
    const state = this.requireState();
    state.phase = "WHITE";
    state.pendingWhite = {};
    const roll = state.roll;
    if (!roll) throw new Error("enterWhitePhase without a roll");
    const sumWhite = roll.w1 + roll.w2;

    for (const seat of this.seats) {
      const sheet = state.sheets[seat.playerId];
      if (!sheet) continue;
      if (!seat.connected || !hasAnyLegalWhiteMove(sheet, sumWhite)) {
        state.pendingWhite[seat.playerId] = { type: "pass" };
      }
    }

    for (const seat of this.seats) {
      if (!seat.isBot || state.pendingWhite[seat.playerId] !== undefined)
        continue;
      const sheet = state.sheets[seat.playerId];
      if (!sheet) continue;
      // A null move here always means the bot itself chose to pass (hard
      // mode only — a genuinely legal-move-less bot seat was already
      // auto-passed by the loop above), so schedule an explicit pass rather
      // than silently doing nothing and leaving it to the slow
      // whitePhaseMs fallback.
      const move = chooseWhiteMove(
        sheet,
        sumWhite,
        seat.botDifficulty ?? "easy",
        this.botRandom,
      );
      this.scheduleBotMove(() => {
        if (move) {
          this.submitWhite(seat.playerId, {
            kind: "cross",
            color: move.color,
            value: move.value,
          });
        } else {
          this.submitWhite(seat.playerId, { kind: "pass" });
        }
      });
    }

    if (this.allConnectedHaveAnswered()) {
      this.closeWhitePhase();
      return;
    }

    this.clearTimer();
    this.phaseDeadline = this.now() + this.whitePhaseMs;
    this.phaseTimer = setTimeout(
      () => this.closeWhitePhase(),
      this.whitePhaseMs,
    );
    this.broadcastSnapshot();
  }

  private allConnectedHaveAnswered(): boolean {
    const state = this.requireState();
    const connected = this.connectedSeats();
    // If nobody is connected, don't treat "every connected seat answered" as
    // vacuously true — that would let the turn loop cascade with zero
    // players present (e.g. everyone disconnecting at once, or all sockets
    // dropping together during a server shutdown). Fall back to the real
    // phase timer instead.
    if (connected.length === 0) return false;
    return connected.every((s) => state.pendingWhite[s.playerId] !== undefined);
  }

  submitWhite(
    playerId: string,
    action: { kind: "cross"; color: Color; value: number } | { kind: "pass" },
  ): { ok: true } | { ok: false; error: string } {
    const state = this.requireStateOrNull();
    if (!state || state.phase !== "WHITE")
      return { ok: false, error: "Not in the white-dice phase" };
    if (!this.hasSeat(playerId))
      return { ok: false, error: "Not seated at this table" };
    if (state.pendingWhite[playerId] !== undefined) {
      return { ok: false, error: "Already submitted this turn" };
    }

    if (action.kind === "cross") {
      const sheet = state.sheets[playerId];
      if (!sheet) return { ok: false, error: "No sheet for player" };
      const roll = state.roll;
      if (!roll) return { ok: false, error: "No active roll" };
      const sumWhite = roll.w1 + roll.w2;
      if (
        action.value !== sumWhite ||
        !canCross(sheet, action.color, action.value)
      ) {
        return { ok: false, error: "Illegal move" };
      }
      // Apply (and broadcast) the cross immediately rather than deferring it
      // to closeWhitePhase(): white crosses only ever touch the submitting
      // player's own sheet, so there's no cross-player ordering to protect,
      // and waiting used to leave an early-submitting player's cross
      // invisible to everyone — including themselves — until every other
      // player (often the active one) also answered.
      applyCross(state, playerId, action.color, action.value);
      const seat = this.seats.find((s) => s.playerId === playerId);
      this.logEvent(
        `${seat?.nickname ?? playerId} crossed ${action.value} in ${action.color} (white).`,
      );
      state.pendingWhite[playerId] = {
        type: "cross",
        color: action.color,
        value: action.value,
      };
    } else {
      state.pendingWhite[playerId] = { type: "pass" };
    }

    if (this.allConnectedHaveAnswered()) {
      this.closeWhitePhase();
    } else {
      this.broadcastSnapshot();
    }
    return { ok: true };
  }

  private closeWhitePhase(): void {
    this.clearTimer();
    const state = this.requireState();
    if (state.phase !== "WHITE") return; // already closed (race between timer and last submit)
    // All crosses were already applied as each player submitted (see
    // submitWhite) — nothing left to do but move on.
    this.enterColorPhase();
  }

  private enterColorPhase(): void {
    this.clearBotTimers();
    const state = this.requireState();
    state.phase = "COLOR";
    const active = activePlayerId(state);
    const seat = this.seats.find((s) => s.playerId === active);
    const sheet = state.sheets[active];
    const roll = state.roll;

    if (
      !seat?.connected ||
      !roll ||
      !sheet ||
      !hasAnyLegalColorMove(sheet, roll, state.diceInPlay)
    ) {
      // Broadcast the COLOR-phase snapshot before immediately closing it —
      // otherwise clients never see a "phase: COLOR" frame at all for a turn
      // where nobody has a legal color move, and the UI jumps straight from
      // WHITE to the next turn's ROLLING/WHITE with only the event log to
      // explain what happened.
      this.broadcastSnapshot();
      this.closeColorPhase(null);
      return;
    }

    if (seat.isBot) {
      // A null move here always means the bot itself chose to pass (hard
      // mode only — a genuinely legal-move-less active seat was already
      // filtered out by the hasAnyLegalColorMove check above), so schedule
      // an explicit pass rather than falling through to the slow
      // colorPhaseMs timer below, which exists for humans who might not
      // answer at all.
      const move = chooseColorMove(
        sheet,
        roll,
        state.diceInPlay,
        seat.botDifficulty ?? "easy",
        this.botRandom,
        this.seats.length,
      );
      this.phaseDeadline = null;
      this.scheduleBotMove(() => {
        if (move) {
          this.submitColor(active, {
            kind: "cross",
            whiteDie: move.whiteDie,
            color: move.color,
            value: move.value,
          });
        } else {
          this.submitColor(active, { kind: "pass" });
        }
      });
      this.broadcastSnapshot();
      return;
    }

    this.clearTimer();
    this.phaseDeadline = this.now() + this.colorPhaseMs;
    this.phaseTimer = setTimeout(
      () => this.closeColorPhase(null),
      this.colorPhaseMs,
    );
    this.broadcastSnapshot();
  }

  submitColor(
    playerId: string,
    action:
      | { kind: "cross"; whiteDie: "w1" | "w2"; color: Color; value: number }
      | { kind: "pass" },
  ): { ok: true } | { ok: false; error: string } {
    const state = this.requireStateOrNull();
    if (!state || state.phase !== "COLOR")
      return { ok: false, error: "Not in the color-dice phase" };
    const active = activePlayerId(state);
    if (playerId !== active)
      return { ok: false, error: "Only the active player may act now" };

    if (action.kind === "cross") {
      const sheet = state.sheets[playerId];
      const roll = state.roll;
      if (!sheet || !roll) return { ok: false, error: "No active roll" };
      const dieValue = roll[action.whiteDie];
      const colorValue = roll[action.color];
      if (
        colorValue === undefined ||
        !state.diceInPlay.has(action.color) ||
        dieValue + colorValue !== action.value ||
        !canCross(sheet, action.color, action.value)
      ) {
        return { ok: false, error: "Illegal move" };
      }
      this.closeColorPhase({ color: action.color, value: action.value });
    } else {
      this.closeColorPhase(null);
    }
    return { ok: true };
  }

  private closeColorPhase(cross: { color: Color; value: number } | null): void {
    this.clearTimer();
    const state = this.requireState();
    if (state.phase !== "COLOR") return;

    if (cross) {
      const active = activePlayerId(state);
      const seat = this.seats.find((s) => s.playerId === active);
      try {
        applyCross(state, active, cross.color, cross.value);
        this.logEvent(
          `${seat?.nickname ?? active} crossed ${cross.value} in ${cross.color} (color).`,
        );
      } catch (err) {
        if (!(err instanceof IllegalMoveError)) throw err;
      }
    }

    state.phase = "RESOLVE";
    this.resolveAndContinue();
  }

  private resolveAndContinue(): void {
    const state = this.requireState();
    const activeBefore = activePlayerId(state);
    const seatBefore = this.seats.find((s) => s.playerId === activeBefore);
    const penaltiesBefore = state.sheets[activeBefore]?.penalties ?? 0;

    resolveTurn(state);

    if ((state.sheets[activeBefore]?.penalties ?? 0) > penaltiesBefore) {
      this.logEvent(
        `${seatBefore?.nickname ?? activeBefore} took a penalty (no cross this turn).`,
      );
    }

    this.store.saveSnapshot(
      this.roomCode,
      state.turnSeq,
      JSON.stringify(serializeGameState(state)),
    );

    if (state.finished) {
      this.lobby = "FINISHED";
      this.phaseDeadline = null;
      this.store.saveResults(this.roomCode, JSON.stringify(state.results));
      this.recordDailyResultIfApplicable();
      this.logEvent("Game over.");
      this.broadcastSnapshot();
      return;
    }

    this.beginRoll();
  }

  /**
   * Records this table's Daily Challenge attempt to the cross-player
   * leaderboard, if it is one. Called from both finish paths (the normal
   * end-of-turn resolution and a host-forced `endGame`) right after
   * `store.saveResults` — each only ever runs once per table (a table can't
   * finish twice), so this can't double-record.
   */
  private recordDailyResultIfApplicable(): void {
    if (!this.daily) return;
    const status = this.computeDailyStatus();
    if (!status?.result) return;
    const { humanPlayerId } = this.daily;
    const total =
      this.state?.results?.find((r) => r.playerId === humanPlayerId)?.total ??
      0;
    this.store.saveDailyResult({
      dateKey: status.dateKey,
      nickname: this.nicknameOf(humanPlayerId),
      playerId: humanPlayerId,
      won: status.result.won,
      playerTurns: status.result.won ? status.result.playerTurns : null,
      total,
      playedAt: this.now(),
    });
  }

  private clearTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  /** Schedules a bot's "thinking" delay before it acts, tracked so it can be cancelled on phase change. */
  private scheduleBotMove(fn: () => void): void {
    const { min, max } = this.botMoveDelayMs;
    const delay = min + this.botRandom() * (max - min);
    const timer = setTimeout(() => {
      this.botTimers.delete(timer);
      fn();
    }, delay);
    this.botTimers.add(timer);
  }

  private clearBotTimers(): void {
    for (const timer of this.botTimers) clearTimeout(timer);
    this.botTimers.clear();
  }

  private requireState(): GameState {
    if (!this.state) throw new Error("Table has no active game state");
    return this.state;
  }

  private requireStateOrNull(): GameState | null {
    return this.state;
  }

  // ---------- Snapshot / broadcast ----------

  private logEvent(text: string): void {
    const evt: EventMessage = { type: "event", text, at: this.now() };
    this.eventLog.push(evt);
    this.broadcast(evt);
  }

  private send(socket: OutSocket, msg: ServerMessage): void {
    socket.send(JSON.stringify(msg));
  }

  private sendTo(playerId: string, msg: ServerMessage): void {
    const socket = this.connections.get(playerId);
    if (socket) this.send(socket, msg);
  }

  sendError(playerId: string, code: string, message: string): void {
    const err: ErrorMessage = { type: "error", code, message };
    this.sendTo(playerId, err);
  }

  private broadcast(msg: ServerMessage): void {
    for (const socket of this.connections.values()) this.send(socket, msg);
  }

  private broadcastSnapshot(): void {
    for (const seat of this.seats) {
      const socket = this.connections.get(seat.playerId);
      if (socket) this.send(socket, this.buildSnapshot(seat.playerId));
    }
  }

  /**
   * Computes the daily-challenge status for the wire, or null for a normal
   * table. `result` stays null until the game actually finishes; turn count
   * is derived from `seatOrder`/`turnSeq` rather than a separate counter,
   * since both are already part of the serialized GameState and so survive
   * a restart for free.
   */
  private computeDailyStatus(): DailyStatus | null {
    if (!this.daily) return null;
    const state = this.state;
    if (!state?.finished || !state.results) {
      return { dateKey: this.daily.dateKey, result: null };
    }

    const { humanPlayerId, botPlayerId } = this.daily;
    const n = state.seatOrder.length;
    let playerTurns = 0;
    for (let i = 0; i <= state.turnSeq; i++) {
      if (state.seatOrder[i % n] === humanPlayerId) playerTurns++;
    }
    const humanTotal =
      state.results.find((r) => r.playerId === humanPlayerId)?.total ?? 0;
    const botTotal =
      state.results.find((r) => r.playerId === botPlayerId)?.total ?? 0;

    return {
      dateKey: this.daily.dateKey,
      result: { won: humanTotal > botTotal, playerTurns },
    };
  }

  buildSnapshot(forPlayerId: string): SnapshotMessage {
    const state = this.state;
    const sheets: PublicSheet[] = this.seats.map((seat) => {
      const sheet = state?.sheets[seat.playerId];
      const rows = (["red", "yellow", "green", "blue"] as const).reduce(
        (acc, color) => {
          const row = sheet?.rows[color];
          const rowValues = ROW_VALUE_TABLES[color];
          const crossedValues = row
            ? row.crossedIndices.map((i) => rowValues[i] as number)
            : [];
          acc[color] = {
            crossedValues,
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
        playerId: seat.playerId,
        nickname: seat.nickname,
        connected: seat.connected,
        isBot: seat.isBot,
        rows,
        penalties: sheet?.penalties ?? 0,
      };
    });

    const results: PublicResult[] | null = state?.results
      ? state.results.map((r) => ({
          playerId: r.playerId,
          nickname: this.nicknameOf(r.playerId),
          total: r.total,
          penaltyPoints: 5 * (state.sheets[r.playerId]?.penalties ?? 0),
          rowScores: r.rowScores,
          rank: r.rank,
        }))
      : null;

    return {
      type: "snapshot",
      roomCode: this.roomCode,
      you: forPlayerId,
      hostPlayerId: this.hostId ?? "",
      lobbyState: this.lobby,
      phase: state?.phase ?? "LOBBY",
      activePlayerId: state ? activePlayerId(state) : null,
      diceInPlay: state
        ? [...state.diceInPlay]
        : ["red", "yellow", "green", "blue"],
      removedColors: state ? [...state.removedColors] : [],
      roll: state?.roll ?? null,
      sheets,
      turnSeq: state?.turnSeq ?? 0,
      phaseDeadline: this.phaseDeadline,
      serverNow: this.now(),
      results,
      whiteSubmitted: state ? Object.keys(state.pendingWhite) : [],
      daily: this.computeDailyStatus(),
    };
  }

  private persistTableMeta(): void {
    this.store.saveTable({
      roomCode: this.roomCode,
      hostPlayerId: this.hostId ?? "",
      seats: this.seats.map((s) => ({
        playerId: s.playerId,
        nickname: s.nickname,
        sessionToken: s.sessionToken,
        isBot: s.isBot,
        botDifficulty: s.botDifficulty,
      })),
      createdAt: this.createdAt,
    });
  }

  destroy(): void {
    this.clearTimer();
    this.clearBotTimers();
  }

  /**
   * Rebuilds a Table from its last persisted snapshot after a server
   * restart. The snapshot is always captured right at the start of a fresh
   * turn (see resolveAndContinue — phase is 'ROLLING' with no pending
   * decisions at the instant it's saved), so resuming only ever needs
   * beginRoll(): no phase-specific reconstruction. All seats start
   * disconnected, and the turn loop deliberately stays paused (see
   * `awaitingFirstReconnectAfterRestore`) until the first player calls
   * `rejoin` — otherwise, with zero seats connected, every phase would
   * auto-close immediately and the game would cascade to completion before
   * any client ever saw the restored state.
   */
  static restore(
    roomCode: string,
    stored: StoredActiveTable,
    deps: TableDeps,
  ): Table {
    const table = new Table(roomCode, deps);
    table.seats = stored.seats.map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
      sessionToken: s.sessionToken,
      // Bot seats have no socket to ever reattach, so they must not be left
      // "disconnected" post-restore — they're always available to act.
      connected: !!s.isBot,
      isBot: !!s.isBot,
      botDifficulty: s.botDifficulty ?? null,
    }));
    table.hostId = stored.hostPlayerId;
    table.lobby = "IN_PROGRESS";
    table.createdAt = stored.createdAt;
    table.state = deserializeGameState(
      JSON.parse(stored.stateJson) as SerializedGameState,
    );
    // Stay paused until the first player reconnects (see attachConnection) —
    // otherwise every phase would auto-close immediately with zero seats
    // connected, and the whole game would cascade to completion before any
    // client ever sees it.
    table.awaitingFirstReconnectAfterRestore = true;
    return table;
  }
}

const ROW_VALUE_TABLES: Record<Color, readonly number[]> = {
  red: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  yellow: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  green: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  blue: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
};

/**
 * Fisher-Yates using the die roller as the entropy source, so picking the
 * starting seat order shares the same injected RNG as dice rolls (real
 * crypto in production, seeded in tests). Folding a 1..6 roll into a 0..i
 * pick isn't perfectly uniform when (i+1) doesn't divide 6, but that's an
 * acceptable approximation for "who goes first" — it's not a scored outcome.
 */
function shuffle<T>(arr: T[], rollOne: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(((rollOne() - 1) * (i + 1)) / 6);
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}
