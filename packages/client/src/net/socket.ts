import type {
  BotDifficulty,
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
  lastError: ErrorMessage | null;
  errorSeq: number;
}

const MAX_EVENTS = 100;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

function initialState(): ClientState {
  return {
    status: "connecting",
    playerId: null,
    snapshot: null,
    events: [],
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

  constructor(private url: string) {}

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
      this.setState({ status: "open" });
      const token = getStoredSessionToken();
      if (token) {
        this.sendRaw({ type: "rejoin", sessionToken: token });
      }
    });

    ws.addEventListener("message", (ev) => {
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
      case "error": {
        if (msg.code === "rejoin_failed") clearStoredSessionToken();
        this.setState({ lastError: msg, errorSeq: this.state.errorSeq + 1 });
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

  leaveTable(): void {
    // Only keep the session token around if the game is still actually live
    // (IN_PROGRESS) — that's what lets the Lobby offer a "rejoin" option.
    // Leaving a LOBBY (not started) or FINISHED (already over) table means
    // there's nothing left to rejoin, so forget the session entirely.
    const wasLive = this.state.snapshot?.lobbyState === "IN_PROGRESS";
    this.sendRaw({ type: "leave_table" });
    if (!wasLive) clearStoredSessionToken();
    this.setState({ snapshot: null, playerId: null, events: [] });
  }

  rejoin(): void {
    const token = getStoredSessionToken();
    if (token) this.sendRaw({ type: "rejoin", sessionToken: token });
  }
}
