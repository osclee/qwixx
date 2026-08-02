import type { GameStore, StoredActiveTable, StoredTable } from "./index.js";

/** No-durability fallback: state lives only in process memory. */
export class MemoryStore implements GameStore {
  private tables = new Map<string, StoredTable>();
  private snapshots = new Map<string, { stateJson: string; turnSeq: number }>();
  private finished = new Set<string>();

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

  saveResults(roomCode: string): void {
    this.finished.add(roomCode);
  }

  deleteTable(roomCode: string): void {
    this.tables.delete(roomCode);
    this.snapshots.delete(roomCode);
    this.finished.delete(roomCode);
  }

  close(): void {
    // no-op
  }
}
