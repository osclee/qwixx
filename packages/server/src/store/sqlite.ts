import type BetterSqlite3 from "better-sqlite3";
import type {
  GameStore,
  StoredActiveTable,
  StoredGameHistory,
  StoredTable,
} from "./index.js";

/**
 * Durable store backed by better-sqlite3 (a native module). One row per
 * table holds the seat list plus the single latest snapshot, overwritten on
 * every RESOLVE — a crash costs at most the in-flight turn (see plan §Part2
 * Persistence). Finished tables are kept for history but excluded from
 * `loadActive` so they aren't rehydrated as live games on boot.
 */
export class SqliteStore implements GameStore {
  private db: BetterSqlite3.Database;
  // Fastify's app.close() can still be delivering queued WS 'close' events
  // (which synchronously resolve a turn and write a snapshot) after this
  // store's own close() has already run as part of the same shutdown — a
  // write landing in that gap should be dropped, not throw, matching the
  // "a crash costs at most the in-flight turn" resilience story above.
  private closed = false;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tables (
        room_code TEXT PRIMARY KEY,
        host_player_id TEXT NOT NULL,
        seats_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        state_json TEXT,
        turn_seq INTEGER,
        finished INTEGER NOT NULL DEFAULT 0,
        results_json TEXT
      );
    `);
  }

  saveTable(table: StoredTable): void {
    if (this.closed) return;
    this.db
      .prepare(
        `INSERT INTO tables (room_code, host_player_id, seats_json, created_at, finished)
         VALUES (@roomCode, @hostPlayerId, @seatsJson, @createdAt, 0)
         ON CONFLICT(room_code) DO UPDATE SET
           host_player_id = excluded.host_player_id,
           seats_json = excluded.seats_json`,
      )
      .run({
        roomCode: table.roomCode,
        hostPlayerId: table.hostPlayerId,
        seatsJson: JSON.stringify(table.seats),
        createdAt: table.createdAt,
      });
  }

  saveSnapshot(roomCode: string, turnSeq: number, stateJson: string): void {
    if (this.closed) return;
    this.db
      .prepare(
        `UPDATE tables SET state_json = ?, turn_seq = ? WHERE room_code = ?`,
      )
      .run(stateJson, turnSeq, roomCode);
  }

  loadActive(): StoredActiveTable[] {
    const rows = this.db
      .prepare(
        `SELECT room_code, host_player_id, seats_json, created_at, state_json, turn_seq
         FROM tables WHERE finished = 0 AND state_json IS NOT NULL`,
      )
      .all() as Array<{
      room_code: string;
      host_player_id: string;
      seats_json: string;
      created_at: number;
      state_json: string;
      turn_seq: number;
    }>;

    return rows.map((r) => ({
      roomCode: r.room_code,
      hostPlayerId: r.host_player_id,
      seats: JSON.parse(r.seats_json),
      createdAt: r.created_at,
      stateJson: r.state_json,
      turnSeq: r.turn_seq,
    }));
  }

  saveResults(roomCode: string, resultsJson: string): void {
    if (this.closed) return;
    this.db
      .prepare(
        `UPDATE tables SET finished = 1, results_json = ? WHERE room_code = ?`,
      )
      .run(resultsJson, roomCode);
  }

  getHistory(roomCode: string): StoredGameHistory | null {
    const row = this.db
      .prepare(
        `SELECT seats_json, created_at, results_json FROM tables
         WHERE room_code = ? AND finished = 1`,
      )
      .get(roomCode) as
      | { seats_json: string; created_at: number; results_json: string | null }
      | undefined;
    if (!row || !row.results_json) return null;
    return {
      roomCode,
      createdAt: row.created_at,
      seats: JSON.parse(row.seats_json),
      results: JSON.parse(row.results_json),
    };
  }

  deleteTable(roomCode: string): void {
    if (this.closed) return;
    this.db.prepare(`DELETE FROM tables WHERE room_code = ?`).run(roomCode);
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }
}

/**
 * Attempts to construct a SqliteStore at `filePath`. Returns null (instead
 * of throwing) if the native module fails to load or open — the caller
 * falls back to MemoryStore so a build/environment problem never blocks
 * server startup.
 */
export async function tryCreateSqliteStore(
  filePath: string,
): Promise<SqliteStore | null> {
  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(filePath);
    return new SqliteStore(db);
  } catch (err) {
    console.warn(
      `[quixx] better-sqlite3 unavailable (${(err as Error).message}); falling back to in-memory storage. Games will not survive a server restart.`,
    );
    return null;
  }
}
