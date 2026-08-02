import { randomUUID } from "node:crypto";
import { Table, type TableDeps } from "./table.js";
import type { GameStore } from "./store/index.js";

// No 0/O/1/I — avoids ambiguous-looking room codes when read aloud or typed.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const IDLE_LOBBY_TTL_MS = 2 * 60 * 60 * 1000; // reap empty/idle lobbies after 2h

export interface SessionInfo {
  roomCode: string;
  playerId: string;
}

export interface RegistryDeps {
  store: GameStore;
  makeTableDeps: () => Omit<TableDeps, "store" | "onEmpty">;
}

/**
 * Owns all live tables and session tokens. A session token maps a
 * reconnecting browser tab back to its seat without needing an account —
 * it's issued once on create/join and stashed by the client in
 * localStorage (see plan §Rooms & sessions).
 */
export class TableRegistry {
  private tables = new Map<string, Table>();
  private sessions = new Map<string, SessionInfo>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private deps: RegistryDeps) {}

  private newRoomCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.tables.has(code)) return code;
    }
    throw new Error("Failed to allocate a unique room code");
  }

  getTable(roomCode: string): Table | undefined {
    return this.tables.get(roomCode.toUpperCase());
  }

  createTable(nickname: string): { table: Table; sessionToken: string; playerId: string } {
    const roomCode = this.newRoomCode();
    const table = new Table(roomCode, {
      store: this.deps.store,
      ...this.deps.makeTableDeps(),
      onEmpty: (code) => this.destroyTable(code),
    });
    this.tables.set(roomCode, table);
    this.scheduleIdleReap(roomCode);

    const playerId = randomUUID();
    const sessionToken = randomUUID();
    table.addSeat(playerId, nickname, sessionToken);
    this.sessions.set(sessionToken, { roomCode, playerId });
    return { table, sessionToken, playerId };
  }

  joinTable(
    roomCode: string,
    nickname: string,
  ): { ok: true; table: Table; sessionToken: string; playerId: string } | { ok: false; error: string } {
    const table = this.getTable(roomCode);
    if (!table) return { ok: false, error: "No table with that room code" };
    const playerId = randomUUID();
    const sessionToken = randomUUID();
    if (!table.addSeat(playerId, nickname, sessionToken)) {
      return {
        ok: false,
        error: table.lobbyState !== "LOBBY" ? "Game already in progress" : "Table is full",
      };
    }
    this.sessions.set(sessionToken, { roomCode, playerId });
    this.scheduleIdleReap(roomCode);
    return { ok: true, table, sessionToken, playerId };
  }

  rejoin(sessionToken: string): { ok: true; table: Table; playerId: string; roomCode: string } | { ok: false; error: string } {
    const session = this.sessions.get(sessionToken);
    if (!session) return { ok: false, error: "Unknown or expired session" };
    const table = this.getTable(session.roomCode);
    if (!table || !table.hasSeat(session.playerId)) {
      return { ok: false, error: "That table no longer exists" };
    }
    this.scheduleIdleReap(session.roomCode);
    return { ok: true, table, playerId: session.playerId, roomCode: session.roomCode };
  }

  /**
   * Rehydrates every table that was still in progress when last persisted
   * (see Table.restore). Called once at server boot. Session tokens are
   * restored from the same persisted seat records so a browser tab that
   * still has its localStorage token can `rejoin` straight into the
   * restored game.
   */
  restoreFromStore(): void {
    for (const stored of this.deps.store.loadActive()) {
      const table = Table.restore(stored.roomCode, stored, {
        store: this.deps.store,
        ...this.deps.makeTableDeps(),
        onEmpty: (code) => this.destroyTable(code),
      });
      this.tables.set(stored.roomCode, table);
      for (const { playerId, sessionToken } of table.listSessions()) {
        this.sessions.set(sessionToken, { roomCode: stored.roomCode, playerId });
      }
      this.scheduleIdleReap(stored.roomCode);
    }
  }

  private scheduleIdleReap(roomCode: string): void {
    const existing = this.idleTimers.get(roomCode);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.destroyTable(roomCode), IDLE_LOBBY_TTL_MS);
    timer.unref?.();
    this.idleTimers.set(roomCode, timer);
  }

  private destroyTable(roomCode: string): void {
    const table = this.tables.get(roomCode);
    if (!table) return;
    table.destroy();
    this.tables.delete(roomCode);
    this.deps.store.deleteTable(roomCode);
    const timer = this.idleTimers.get(roomCode);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(roomCode);
    for (const [token, session] of this.sessions) {
      if (session.roomCode === roomCode) this.sessions.delete(token);
    }
  }
}
