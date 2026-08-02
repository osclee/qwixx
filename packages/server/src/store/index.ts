import type { BotDifficulty } from "../bot.js";

export interface StoredSeat {
  playerId: string;
  nickname: string;
  /** Persisted so a rejoin still works for the same browser tab after a server restart. */
  sessionToken: string;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
}

export interface StoredTable {
  roomCode: string;
  hostPlayerId: string;
  seats: StoredSeat[];
  createdAt: number;
}

export interface StoredActiveTable extends StoredTable {
  /** JSON-serialized GameState (see serialize.ts) from the most recent RESOLVE. */
  stateJson: string;
  turnSeq: number;
}

/**
 * Persistence boundary. `MemoryStore` is the always-available fallback;
 * `SqliteStore` adds durability across restarts. Both are swappable behind
 * this interface so a native-module build failure degrades gracefully
 * instead of blocking the server from starting (see store/sqlite.ts).
 */
export interface GameStore {
  saveTable(table: StoredTable): void;
  /** Overwrites the single latest snapshot for a room — called once per RESOLVE. */
  saveSnapshot(roomCode: string, turnSeq: number, stateJson: string): void;
  /** Tables that were still in progress (not finished) when last persisted. */
  loadActive(): StoredActiveTable[];
  saveResults(roomCode: string, resultsJson: string): void;
  deleteTable(roomCode: string): void;
  close(): void;
}
