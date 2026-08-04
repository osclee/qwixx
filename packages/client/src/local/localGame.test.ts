import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalGameStore } from "./localGame";
import { legalColorCombos } from "../net/legalMoves";

/** Maps a target die face (1-6) to the Math.random() fraction that produces it via 1 + floor(r*6). */
function dieFraction(value: number): number {
  return (value - 0.5) / 6;
}

function mockDiceSequence(values: number[]): void {
  let i = 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    const v = values[i % values.length] as number;
    i += 1;
    return dieFraction(v);
  });
}

describe("LocalGameStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts a game with the given players, seated in ROLLING phase", () => {
    const store = new LocalGameStore();
    store.start(["Alice", "Bob"]);
    const snap = store.getSnapshot();

    expect(snap).not.toBeNull();
    expect(snap!.phase).toBe("ROLLING");
    expect(snap!.roll).toBeNull();
    expect(snap!.sheets.map((s) => s.nickname).sort()).toEqual([
      "Alice",
      "Bob",
    ]);
    expect(snap!.activePlayerId).not.toBeNull();
  });

  it("rejects a player count outside 2-5", () => {
    const store = new LocalGameStore();
    expect(() => store.start(["Solo"])).toThrow();
    expect(() => store.start(["A", "B", "C", "D", "E", "F"])).toThrow();
  });

  it("drives a full turn: roll -> white (all seats answer) -> color (active only) -> back to ROLLING", () => {
    const store = new LocalGameStore();
    store.start(["Alice", "Bob"]);
    let snap = store.getSnapshot()!;
    const [p1, p2] = snap.sheets.map((s) => s.playerId) as [string, string];
    const firstActive = snap.activePlayerId!;

    mockDiceSequence([3, 4, 2, 5, 6, 2]); // w1=3 w2=4 (sum 7); red=2 yellow=5 green=6 blue=2
    store.rollDice();
    snap = store.getSnapshot()!;
    expect(snap.phase).toBe("WHITE");
    expect(snap.roll).toEqual({
      w1: 3,
      w2: 4,
      red: 2,
      yellow: 5,
      green: 6,
      blue: 2,
    });

    // Crossing the white sum is applied immediately per-submission, not batched.
    store.submitWhite(p1, { kind: "cross", color: "red", value: 7 });
    snap = store.getSnapshot()!;
    expect(snap.phase).toBe("WHITE"); // still waiting on the other seat
    expect(snap.whiteSubmitted).toEqual([p1]);
    expect(
      snap.sheets.find((s) => s.playerId === p1)!.rows.red.crossedValues,
    ).toEqual([7]);

    store.submitWhite(p2, { kind: "pass" });
    snap = store.getSnapshot()!;
    expect(snap.phase).toBe("COLOR");
    expect(snap.activePlayerId).toBe(firstActive);

    const activeSheet = snap.sheets.find(
      (s) => s.playerId === snap.activePlayerId,
    )!;
    const combos = legalColorCombos(activeSheet, snap.roll!, snap.diceInPlay);
    expect(combos.length).toBeGreaterThan(0);
    const combo = combos[0]!;
    store.submitColor({
      kind: "cross",
      whiteDie: combo.whiteDie,
      color: combo.color,
      value: combo.value,
    });

    snap = store.getSnapshot()!;
    expect(snap.phase).toBe("ROLLING");
    expect(snap.roll).toBeNull();
    expect(snap.activePlayerId).not.toBe(firstActive);
  });

  it("penalizes the active player for a turn with zero crosses", () => {
    const store = new LocalGameStore();
    store.start(["Alice", "Bob"]);
    const firstActive = store.getSnapshot()!.activePlayerId!;

    mockDiceSequence([1, 1, 1, 1, 1, 1]);
    store.rollDice();

    let snap = store.getSnapshot()!;
    for (const s of snap.sheets) {
      if (!snap.whiteSubmitted.includes(s.playerId)) {
        store.submitWhite(s.playerId, { kind: "pass" });
      }
    }

    snap = store.getSnapshot()!;
    if (snap.phase === "COLOR") {
      store.submitColor({ kind: "pass" });
      snap = store.getSnapshot()!;
    }

    const activeSheetAfter = snap.sheets.find(
      (s) => s.playerId === firstActive,
    )!;
    expect(activeSheetAfter.penalties).toBe(1);
  });

  it("newGame reshuffles into a fresh game; exit clears the snapshot", () => {
    const store = new LocalGameStore();
    store.start(["Alice", "Bob"]);
    store.endGame();
    expect(store.getSnapshot()!.phase).toBe("FINISHED");

    store.newGame();
    const snap = store.getSnapshot()!;
    expect(snap.phase).toBe("ROLLING");
    expect(snap.results).toBeNull();
    expect(snap.sheets.map((s) => s.nickname).sort()).toEqual([
      "Alice",
      "Bob",
    ]);

    store.exit();
    expect(store.getSnapshot()).toBeNull();
  });

  it("endGame scores the sheets as they stand and finishes immediately", () => {
    const store = new LocalGameStore();
    store.start(["Alice", "Bob", "Cara"]);
    store.endGame();
    const snap = store.getSnapshot()!;
    expect(snap.phase).toBe("FINISHED");
    expect(snap.results).not.toBeNull();
    expect(snap.results!.map((r) => r.nickname).sort()).toEqual([
      "Alice",
      "Bob",
      "Cara",
    ]);
  });
});
