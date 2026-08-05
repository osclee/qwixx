import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table } from "./Table";
import type { GameConnection } from "../net/socket";
import type {
  Color,
  PublicRowState,
  PublicSheet,
  SnapshotMessage,
} from "../net/protocol";

function emptyRow(): PublicRowState {
  return { crossedValues: [], lastCrossedIndex: -1, locked: false, marks: 0, score: 0 };
}

function makeSheet(playerId: string, nickname: string): PublicSheet {
  const colors: Color[] = ["red", "yellow", "green", "blue"];
  const rows = {} as Record<Color, PublicRowState>;
  for (const color of colors) rows[color] = emptyRow();
  return { playerId, nickname, connected: true, isBot: false, rows, penalties: 0 };
}

function makeSnapshot(): SnapshotMessage {
  return {
    type: "snapshot",
    roomCode: "ABCDE",
    you: "you",
    hostPlayerId: "you",
    lobbyState: "IN_PROGRESS",
    phase: "WHITE",
    activePlayerId: "you",
    diceInPlay: ["red", "yellow", "green", "blue"],
    removedColors: [],
    // w1 + w2 === 5, matching row's legal cell below.
    roll: { w1: 2, w2: 3 },
    sheets: [makeSheet("you", "Alice"), makeSheet("opp", "Bob")],
    turnSeq: 0,
    phaseDeadline: null,
    serverNow: Date.now(),
    results: null,
    whiteSubmitted: [],
    daily: null,
  };
}

function makeConn(): GameConnection {
  return {
    submitWhite: vi.fn(),
    submitColor: vi.fn(),
    rollDice: vi.fn(),
    newGame: vi.fn(),
    endGame: vi.fn(),
    leaveTable: vi.fn(),
    sendChat: vi.fn(),
  } as unknown as GameConnection;
}

describe("Table connection status", () => {
  it("keeps own-sheet cells clickable while the connection is open", async () => {
    const user = userEvent.setup();
    const conn = makeConn();
    const { container } = render(
      <Table
        conn={conn}
        snapshot={makeSnapshot()}
        you="you"
        events={[]}
        chatMessages={[]}
        status="open"
      />,
    );

    expect(within(container).queryByRole("status")).toBeNull();
    const cell = within(container).getAllByText("5")[0]!.closest("button")!;
    expect(cell).toBeEnabled();
    await user.click(cell);
    expect(conn.submitWhite).toHaveBeenCalledWith({
      kind: "cross",
      color: "red",
      value: 5,
    });
  });

  it("shows a banner and disables own-sheet cells while reconnecting", async () => {
    const user = userEvent.setup();
    const conn = makeConn();
    const { container } = render(
      <Table
        conn={conn}
        snapshot={makeSnapshot()}
        you="you"
        events={[]}
        chatMessages={[]}
        status="reconnecting"
      />,
    );

    expect(within(container).getByRole("status")).toHaveTextContent(
      /reconnecting/i,
    );
    const cell = within(container).getAllByText("5")[0]!.closest("button")!;
    expect(cell).toBeDisabled();
    await user.click(cell);
    expect(conn.submitWhite).not.toHaveBeenCalled();
  });
});
