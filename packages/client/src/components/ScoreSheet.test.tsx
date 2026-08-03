import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScoreSheet } from "./ScoreSheet";
import type { Color, PublicRowState, PublicSheet } from "../net/protocol";

function emptyRow(): PublicRowState {
  return { crossedValues: [], lastCrossedIndex: -1, locked: false, marks: 0, score: 0 };
}

function makeSheet(): PublicSheet {
  const colors: Color[] = ["red", "yellow", "green", "blue"];
  const rows = {} as Record<Color, PublicRowState>;
  for (const color of colors) rows[color] = emptyRow();
  return {
    playerId: "p1",
    nickname: "Alice",
    connected: true,
    isBot: false,
    rows,
    penalties: 0,
  };
}

function cellButton(container: HTMLElement, color: Color, value: number) {
  const row = container.querySelector(`.row--${color}`) as HTMLElement;
  return within(row).getByText(String(value)).closest("button")!;
}

describe("ScoreSheet cell clicks", () => {
  it("fires onCellClick for a cell marked legal", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();
    const { container } = render(
      <ScoreSheet
        sheet={makeSheet()}
        legalValues={{ red: new Set([5]) }}
        onCellClick={onCellClick}
      />,
    );

    await user.click(cellButton(container, "red", 5));

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick).toHaveBeenCalledWith("red", 5);
  });

  it("does not fire onCellClick for a cell that isn't legal", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();
    const { container } = render(
      <ScoreSheet
        sheet={makeSheet()}
        legalValues={{ red: new Set([5]) }}
        onCellClick={onCellClick}
      />,
    );

    const illegalCell = cellButton(container, "red", 6);
    expect(illegalCell).toBeDisabled();

    await user.click(illegalCell);

    expect(onCellClick).not.toHaveBeenCalled();
  });
});
