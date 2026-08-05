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
  it("renders an all-empty summary and penalty row for a shutout loss", () => {
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
    expect(lines[3]).toBe("🟥0/11  🟨0/11  🟩0/11  🟦0/11");
    expect(lines[4]).toBe("❌❌❌❌");
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

  it("counts crossed cells per color regardless of which values were crossed", () => {
    const text = buildShareText({
      dateKey: "2026-08-05",
      won: true,
      playerTurns: 7,
      score: 98,
      rows: {
        red: { crossedValues: [2, 4], locked: false },
        green: { crossedValues: [12, 10, 8], locked: false },
        yellow: { crossedValues: [], locked: false },
        blue: { crossedValues: [], locked: false },
      },
      penalties: 1,
    });
    const lines = text.split("\n");
    expect(lines[1]).toBe("🏆 Beat the bot in 7 turns! (98 pts)");
    expect(lines[3]).toBe("🟥2/11  🟨0/11  🟩3/11  🟦0/11");
    expect(lines[4]).toBe("❌⬜⬜⬜");
  });

  it("appends a lock icon once a row is locked", () => {
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
    const summaryLine = text.split("\n")[3];
    expect(summaryLine).toBe("🟥6/11🔒  🟨0/11  🟩0/11  🟦0/11");
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
    expect(text.split("\n")).toHaveLength(5);
  });
});
