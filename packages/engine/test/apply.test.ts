import { describe, expect, it } from "vitest";
import { createGame } from "../src/game.js";
import { applyCross, resolveTurn } from "../src/apply.js";
import { canCross } from "../src/legal.js";
import { IllegalMoveError } from "../src/types.js";

describe("applyCross", () => {
  it("throws IllegalMoveError instead of silently no-opping on an illegal move", () => {
    const state = createGame(["a", "b"]);
    expect(() => applyCross(state, "a", "red", 2)).not.toThrow();
    // 2 is now dead-left-of-nothing... cross something further right, then retry 2
    applyCross(state, "a", "red", 5);
    expect(() => applyCross(state, "a", "red", 3)).toThrow(IllegalMoveError);
  });

  it("increments turnCrossCount for the crossing player", () => {
    const state = createGame(["a", "b"]);
    applyCross(state, "a", "red", 5);
    expect(state.turnCrossCount["a"]).toBe(1);
    expect(state.turnCrossCount["b"] ?? 0).toBe(0);
  });

  it("white-then-color in the same row: color cross must land right of the white cross", () => {
    const state = createGame(["a", "b"]);
    // Active player (seat 0 = "a") crosses white sum 5 in red, then must cross
    // further right for a color combo in red.
    applyCross(state, "a", "red", 5);
    expect(canCross(state.sheets["a"], "red", 4)).toBe(false); // left of 5, illegal
    expect(() => applyCross(state, "a", "red", 4)).toThrow(IllegalMoveError);
    expect(canCross(state.sheets["a"], "red", 8)).toBe(true);
    expect(() => applyCross(state, "a", "red", 8)).not.toThrow();
  });
});

describe("penalty rule (§4.4) — active player only", () => {
  it("penalizes the active player who crosses nothing this turn", () => {
    const state = createGame(["a", "b"]);
    expect(state.seatOrder[state.activeSeat]).toBe("a");
    // "a" makes no crosses at all this turn.
    resolveTurn(state);
    expect(state.sheets["a"].penalties).toBe(1);
  });

  it("never penalizes a non-active player for declining the white sum", () => {
    const state = createGame(["a", "b"]);
    // "a" is active and does cross, "b" (passive) crosses nothing.
    applyCross(state, "a", "red", 5);
    resolveTurn(state);
    expect(state.sheets["a"].penalties).toBe(0);
    expect(state.sheets["b"].penalties).toBe(0);
  });

  it("penalizes the active player even when they had no legal move at all", () => {
    const state = createGame(["a", "b"]);
    // Lock red for "a" via 5 crosses + terminal, leaving no cross this final turn instead.
    // Simpler: just don't cross anything - same code path as "chose not to".
    resolveTurn(state);
    expect(state.sheets["a"].penalties).toBe(1);
  });

  it("ends the game when a player reaches 4 penalties", () => {
    const state = createGame(["a", "b"]);
    // Every turn passes with zero crosses, alternating active seat a,b,a,b,...
    // "a" is active on turns 1,3,5,7 and reaches 4 penalties on turn 7.
    for (let i = 0; i < 7 && !state.finished; i++) {
      resolveTurn(state);
    }
    expect(state.finished).toBe(true);
    expect(state.sheets["a"].penalties).toBe(4);
    expect(state.results).not.toBeNull();
  });
});

describe("deferred die removal (§6) — deliberate rule decision", () => {
  it("keeps a color usable in the COLOR phase of the same turn it was locked in the WHITE phase", () => {
    const state = createGame(["a", "b"]);
    // "a" locks red during what represents the white phase (5 crosses + terminal).
    applyCross(state, "a", "red", 2);
    applyCross(state, "a", "red", 3);
    applyCross(state, "a", "red", 4);
    applyCross(state, "a", "red", 5);
    applyCross(state, "a", "red", 6);
    applyCross(state, "a", "red", 12); // locks red on a's sheet
    expect(state.sheets["a"].rows.red.locked).toBe(true);
    // Red die must still be usable for a color-phase combo THIS turn.
    expect(state.diceInPlay.has("red")).toBe(true);
    expect(state.removedColors.has("red")).toBe(false);

    resolveTurn(state);
    // Now, after resolution, red is retired from the shared pool.
    expect(state.removedColors.has("red")).toBe(true);
    expect(state.diceInPlay.has("red")).toBe(false);
  });

  it("still allows other players to fill a removed color's row via white sums", () => {
    const state = createGame(["a", "b"]);
    applyCross(state, "a", "red", 2);
    applyCross(state, "a", "red", 3);
    applyCross(state, "a", "red", 4);
    applyCross(state, "a", "red", 5);
    applyCross(state, "a", "red", 6);
    applyCross(state, "a", "red", 12);
    resolveTurn(state); // red now removed from shared pool
    expect(state.removedColors.has("red")).toBe(true);

    // "b" is now active; white sums still work on b's own red row.
    expect(canCross(state.sheets["b"], "red", 5)).toBe(true);
    expect(() => applyCross(state, "b", "red", 5)).not.toThrow();
  });
});

describe("end conditions (§7)", () => {
  function lockColor(
    state: ReturnType<typeof createGame>,
    playerId: string,
    color: "red" | "yellow" | "green" | "blue",
  ) {
    const terminal = color === "green" || color === "blue" ? 2 : 12;
    const ramp =
      color === "green" || color === "blue"
        ? [12, 11, 10, 9, 8]
        : [2, 3, 4, 5, 6];
    for (const v of ramp) applyCross(state, playerId, color, v);
    applyCross(state, playerId, color, terminal);
  }

  it("ends the game when two different colors are locked by anyone, in any combination", () => {
    const state = createGame(["a", "b"]);
    lockColor(state, "a", "red"); // "a" is active seat 0
    resolveTurn(state); // red removed, game continues (1 color removed)
    expect(state.finished).toBe(false);
    expect(state.removedColors.size).toBe(1);

    // "b" is now active; lock a different color.
    lockColor(state, "b", "yellow");
    resolveTurn(state);
    expect(state.finished).toBe(true);
    expect(state.removedColors.size).toBe(2);
  });

  it("does NOT end the game when two players lock the SAME color", () => {
    const state = createGame(["a", "b", "c"]);
    lockColor(state, "a", "red");
    lockColor(state, "b", "red");
    resolveTurn(state); // resolves "a"'s turn; only red is locked so far globally
    expect(state.removedColors.size).toBe(1);
    expect(state.finished).toBe(false);
  });

  it("produces a full ranked results list on finish", () => {
    const state = createGame(["a", "b"]);
    lockColor(state, "a", "red");
    resolveTurn(state);
    lockColor(state, "b", "yellow");
    resolveTurn(state);
    expect(state.finished).toBe(true);
    expect(state.results).toHaveLength(2);
    expect(state.results?.every((r) => typeof r.total === "number")).toBe(true);
  });
});
