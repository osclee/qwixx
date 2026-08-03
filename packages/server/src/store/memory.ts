import type {
  GameStore,
  StoredActiveTable,
  StoredGameHistory,
  StoredTable,
} from "./index.js";

/** No-durability fallback: state lives only in process memory. */
export class MemoryStore implements GameStore {
  private tables = new Map<string, StoredTable>();
  private snapshots = new Map<string, { stateJson: string; turnSeq: number }>();
  private finished = new Set<string>();
  private results = new Map<string, string>();

  saveTable(table: StoredTable): void {
    this.tables.set(table.roomCode, table);
  }

  saveSnapshot(roomCode: string, turnSeq: number, stateJson: string): void {
    this.snapshots.set(roomCode, { stateJson, turnSeq });
  }

  loadActive(): StoredActiveTable[] {
    const out: StoredActiveTable[] = [];
    for (const [roomCode, table] of this.tables) {
      if (this.finished.has(roomCode)) continue;
      const snap = this.snapshots.get(roomCode);
      if (!snap) continue;
      out.push({ ...table, stateJson: snap.stateJson, turnSeq: snap.turnSeq });
    }
    return out;
  }

  saveResults(roomCode: string, resultsJson: string): void {
    this.finished.add(roomCode);
    this.results.set(roomCode, resultsJson);
  }

  getHistory(roomCode: string): StoredGameHistory | null {
    if (!this.finished.has(roomCode)) return null;
    const table = this.tables.get(roomCode);
    const resultsJson = this.results.get(roomCode);
    if (!table || !resultsJson) return null;
    return {
      roomCode: table.roomCode,
      createdAt: table.createdAt,
      seats: table.seats,
      results: JSON.parse(resultsJson),
    };
  }

  deleteTable(roomCode: string): void {
    this.tables.delete(roomCode);
    this.snapshots.delete(roomCode);
    this.finished.delete(roomCode);
    this.results.delete(roomCode);
  }

  close(): void {
    // no-op
  }
}
