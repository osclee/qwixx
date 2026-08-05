import type {
  BotDifficulty,
  ChatMessage,
  ClientMessage,
  ColorActionInput,
  ErrorMessage,
  EventMessage,
  ServerMessage,
  SnapshotMessage,
  WhiteActionInput,
} from "./protocol";
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  setStoredSessionToken,
} from "./session";

export type ConnectionStatus =
  "connecting" | "open" | "reconnecting" | "closed";

export interface ClientState {
  status: ConnectionStatus;
  playerId: string | null;
  snapshot: SnapshotMessage | null;
  events: EventMessage[];
  chatMessages: ChatMessage[];
  lastError: ErrorMessage | null;
  errorSeq: number;
}

const MAX_EVENTS = 100;
const MAX_CHAT_MESSAGES = 200;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;
// The server pings every connection (native ping + an app-level "ping"
// message) on DEFAULT_HEARTBEAT_INTERVAL_MS (see server/src/ws.ts). If
// nothing at all has arrived in this long, the connection is presumed dead
// -- e.g. a half-open socket after the laptop slept or the network changed,
// which produces no 'close' event on its own. Comfortably more than one
// server heartbeat interval so ordinary jitter doesn't trip it.
const WATCHDOG_STALE_MS = 45_000;
const WATCHDOG_CHECK_MS = 5_000;

function initialState(): ClientState {
  return {
    status: "connecting",
    playerId: null,
    snapshot: null,
    events: [],
    chatMessages: [],
    lastError: null,
    errorSeq: 0,
  };
}

/**
 * Owns the single WebSocket connection to the server and the client's view
 * of the current table. Exposed as a tiny external store (getState +
 * subscribe) so React can consume it via useSyncExternalStore — the
 * connection's lifetime is independent of any particular component tree.
 */
export class GameConnection {
  private ws: WebSocket | null = null;
  private state: ClientState = initialState();
  private listeners = new Set<() => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private lastMessageAt = Date.now();

  constructor(private url: string) {
    setInterval(() => this.checkWatchdog(), WATCHDOG_CHECK_MS);
  }

  /**
   * Forces a reconnect if the socket claims to be open but nothing has come
   * in (not even a heartbeat ping) for WATCHDOG_STALE_MS -- the client-side
   * counterpart to the server's own dead-peer detection. Without this, a
   * half-open connection just sits there looking "open" while every click
   * silently vanishes (sendRaw no-ops unless readyState is OPEN, but a
   * zombie socket can still report OPEN), and the player has no path back
   * to a working game short of a manual refresh.
   */
  private checkWatchdog(): void {
    if (
      this.ws &&
      this.state.status === "open" &&
      Date.now() - this.lastMessageAt > WATCHDOG_STALE_MS
    ) {
      this.ws.close();
    }
  }

  getState(): ClientState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  connect(): void {
    this.manualClose = false;
    this.openSocket();
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.setState({
      status: this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
    });

    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.setState({ status: "open" });
      const token = getStoredSessionToken();
      if (token) {
        this.sendRaw({ type: "rejoin", sessionToken: token });
      }
    });

    ws.addEventListener("message", (ev) => {
      this.lastMessageAt = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.manualClose) {
        this.setState({ status: "closed" });
        return;
      }
      this.setState({ status: "reconnecting" });
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) this.openSocket();
    }, delay);
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "joined": {
        setStoredSessionToken(msg.sessionToken);
        this.setState({ playerId: msg.playerId });
        break;
      }
      case "snapshot": {
        // No staleness check needed: a single WebSocket connection delivers
        // messages strictly in order, and a fresh connection (reconnect)
        // only ever sees messages generated after it attached — there's no
        // path for an older snapshot to arrive after a newer one. (An
        // earlier version compared turnSeq here, which broke when a new
        // game reset it back to 0 — see Table.newGame — silently dropping
        // the "back to lobby" snapshot as if it were stale.)
        this.setState({ snapshot: msg, playerId: msg.you });
        break;
      }
      case "event": {
        const events = [...this.state.events, msg].slice(-MAX_EVENTS);
        this.setState({ events });
        break;
      }
      case "chat_broadcast": {
        const chatMessages = [...this.state.chatMessages, msg].slice(
          -MAX_CHAT_MESSAGES,
        );
        this.setState({ chatMessages });
        break;
      }
      case "error": {
        if (msg.code === "rejoin_failed") clearStoredSessionToken();
        this.setState({ lastError: msg, errorSeq: this.state.errorSeq + 1 });
        break;
      }
      case "ping": {
        // No-op: receiving it at all is what resets the watchdog above.
        break;
      }
    }
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  createTable(nickname: string): void {
    this.sendRaw({ type: "create_table", nickname });
  }

  createDailyTable(nickname: string): void {
    this.sendRaw({ type: "create_daily_table", nickname });
  }

  joinTable(roomCode: string, nickname: string): void {
    this.sendRaw({
      type: "join_table",
      roomCode: roomCode.toUpperCase(),
      nickname,
    });
  }

  startGame(): void {
    this.sendRaw({ type: "start_game" });
  }

  rollDice(): void {
    this.sendRaw({ type: "roll_dice" });
  }

  newGame(): void {
    this.sendRaw({ type: "new_game" });
  }

  endGame(): void {
    this.sendRaw({ type: "end_game" });
  }

  submitWhite(action: WhiteActionInput): void {
    this.sendRaw({ type: "submit_white", action });
  }

  submitColor(action: ColorActionInput): void {
    this.sendRaw({ type: "submit_color", action });
  }

  addBot(difficulty: BotDifficulty): void {
    this.sendRaw({ type: "add_bot", difficulty });
  }

  removeBot(playerId: string): void {
    this.sendRaw({ type: "remove_bot", playerId });
  }

  sendChat(text: string): void {
    this.sendRaw({ type: "chat_message", text });
  }

  leaveTable(): void {
    // Only keep the session token around if the game is still actually live
    // (IN_PROGRESS) — that's what lets the Lobby offer a "rejoin" option.
    // Leaving a LOBBY (not started) or FINISHED (already over) table means
    // there's nothing left to rejoin, so forget the session entirely.
    const wasLive = this.state.snapshot?.lobbyState === "IN_PROGRESS";
    this.sendRaw({ type: "leave_table" });
    if (!wasLive) clearStoredSessionToken();
    this.setState({
      snapshot: null,
      playerId: null,
      events: [],
      chatMessages: [],
    });
  }

  rejoin(): void {
    const token = getStoredSessionToken();
    if (token) this.sendRaw({ type: "rejoin", sessionToken: token });
  }
}
