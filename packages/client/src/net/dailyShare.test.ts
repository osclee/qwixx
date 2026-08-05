import { describe, expect, it } from "vitest";
import { buildShareText, type DailyShareData } from "./dailyShare";

function emptyRows(): DailyShareData["rows"] {
  return {
    red: { crossedValues: [], locked: false },
    yellow: { crossedValues: [], locked: false },
    green: { crossedValues: [], locked: false },
    blue: { crossedValues: [], locked: false },
  };
}

describe("buildShareText", () => {
  it("renders an all-empty grid and penalty row for a shutout loss", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: false,
      playerTurns: null,
      score: 0,
      rows: emptyRows(),
      penalties: 4,
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Qwixx Daily #2026-08-05");
    expect(lines[1]).toBe("💀 Lost to the bot (0 pts)");
    expect(lines[3]).toBe("⬜".repeat(11)); // red
    expect(lines[4]).toBe("⬜".repeat(11)); // yellow
    expect(lines[5]).toBe("⬜".repeat(11)); // green
    expect(lines[6]).toBe("⬜".repeat(11)); // blue
    expect(lines[7]).toBe("❌❌❌❌");
  });

  it("still reports a non-zero score on a loss", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: false,
      playerTurns: null,
      score: 47,
      rows: emptyRows(),
      penalties: 2,
    });
    expect(text.split("\n")[1]).toBe("💀 Lost to the bot (47 pts)");
  });

  it("marks crossed cells in the correct left-to-right position, respecting ascending vs descending rows", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: true,
      playerTurns: 7,
      score: 98,
      rows: {
        // red is ascending (2..12): crossing 2 and 4 should fill columns 0 and 2.
        red: { crossedValues: [2, 4], locked: false },
        // green is descending (12..2): crossing 12 and 10 should fill columns 0 and 2.
        green: { crossedValues: [12, 10], locked: false },
        yellow: { crossedValues: [], locked: false },
        blue: { crossedValues: [], locked: false },
      },
      penalties: 1,
    });
    const lines = text.split("\n");
    expect(lines[1]).toBe("🏆 Beat the bot in 7 turns! (98 pts)");
    expect(lines[3]).toBe("🟥⬜🟥⬜⬜⬜⬜⬜⬜⬜⬜"); // red: values 2,4 -> indices 0,2
    expect(lines[5]).toBe("🟩⬜🟩⬜⬜⬜⬜⬜⬜⬜⬜"); // green descending [12,11,10,...]: values 12,10 -> indices 0,2
    expect(lines[7]).toBe("❌⬜⬜⬜");
  });

  it("renders the terminal cell as a lock icon once a row is locked", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: true,
      playerTurns: 12,
      score: 120,
      rows: {
        red: {
          crossedValues: [2, 3, 4, 5, 6, 12],
          locked: true,
        },
        yellow: { crossedValues: [], locked: false },
        green: { crossedValues: [], locked: false },
        blue: { crossedValues: [], locked: false },
      },
      penalties: 0,
    });
    const redLine = text.split("\n")[3];
    expect(redLine).toBe("🟥🟥🟥🟥🟥⬜⬜⬜⬜⬜🔒");
  });

  it("uses singular 'turn' for a one-turn win", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: true,
      playerTurns: 1,
      score: 10,
      rows: emptyRows(),
      penalties: 0,
    });
    expect(text.split("\n")[1]).toBe("🏆 Beat the bot in 1 turn! (10 pts)");
  });

  it("appends the origin as a trailing line when provided", () => {
    const text = buildShareText(
      {
        dateKey: "2026-08-05",
        won: false,
        playerTurns: null,
        score: 0,
        rows: emptyRows(),
        penalties: 0,
      },
      "https://qwixx.example.com",
    );
    expect(text.endsWith("https://qwixx.example.com")).toBe(true);
  });

  it("omits a trailing origin line when none is provided", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: false,
      playerTurns: null,
      score: 0,
      rows: emptyRows(),
      penalties: 0,
    });
    // Last line should be the penalty row itself, not a blank line + origin.
    expect(text.endsWith("⬜⬜⬜⬜")).toBe(true);
    expect(text.split("\n")).toHaveLength(8);
  });
});
