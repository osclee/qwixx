import { afterEach, describe, expect, it } from "vitest";
import { startTestServer } from "./testServer.js";
import { TestClient } from "./testClient.js";
import type { SnapshotMessage } from "../src/protocol.js";

describe("rematch (new_game)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it("lets the host send a finished table back to the lobby and start a fresh game", async () => {
    const server = await startTestServer({ seed: 8 });
    close = server.close;

    const alice = await TestClient.connect(server.url);
    alice.send({ type: "create_table", nickname: "Alice" });
    const aliceJoined = await alice.waitForType("joined");

    const bob = await TestClient.connect(server.url);
    bob.send({
      type: "join_table",
      roomCode: aliceJoined.roomCode,
      nickname: "Bob",
    });
    const _bobJoined = await bob.waitForType("joined");

    await alice.waitForSnapshot((s) => s.sheets.length === 2);

    // Only the host may start a new game, even mid-lobby before anything's played.
    bob.send({ type: "new_game" });
    const earlyErr = await bob.waitForType("error");
    expect(earlyErr.code).toBe("new_game_failed");

    alice.send({ type: "start_game" });

    // A new_game request mid-game must be rejected too.
    alice.send({ type: "new_game" });
    const midGameErr = await alice.waitForType("error");
    expect(midGameErr.code).toBe("new_game_failed");
    expect(midGameErr.message).toMatch(/not over/i);

    // Drive the game to completion purely by passing everything.
    let finalSnap: SnapshotMessage | null = null;
    let whiteSnap = await alice.waitForSnapshot(
      (s) => s.phase === "WHITE" || s.phase === "FINISHED",
    );
    for (let turn = 0; turn < 60 && !finalSnap; turn++) {
      if (whiteSnap.phase === "FINISHED") {
        finalSnap = whiteSnap;
        break;
      }
      alice.send({ type: "submit_white", action: { kind: "pass" } });
      bob.send({ type: "submit_white", action: { kind: "pass" } });

      const colorOrFinished = (await alice.waitFor(
        (m) =>
          m.type === "snapshot" &&
          (m.phase === "COLOR" || m.phase === "FINISHED"),
      )) as SnapshotMessage;
      if (colorOrFinished.phase === "FINISHED") {
        finalSnap = colorOrFinished;
        break;
      }
      const active =
        colorOrFinished.activePlayerId === aliceJoined.playerId ? alice : bob;
      active.send({ type: "submit_color", action: { kind: "pass" } });

      whiteSnap = (await alice.waitFor(
        (m) =>
          m.type === "snapshot" &&
          (m.phase === "WHITE" || m.phase === "FINISHED"),
      )) as SnapshotMessage;
    }
    if (!finalSnap) throw new Error("game did not finish within 60 turns");
    expect(finalSnap.lobbyState).toBe("FINISHED");

    // Non-host still can't start a rematch.
    bob.send({ type: "new_game" });
    const bobErr = await bob.waitForType("error");
    expect(bobErr.code).toBe("new_game_failed");
    expect(bobErr.message).toMatch(/host/i);

    // Host sends the table back to the lobby.
    alice.send({ type: "new_game" });
    const lobbySnap = await alice.waitForSnapshot(
      (s) => s.lobbyState === "LOBBY",
    );
    expect(lobbySnap.phase).toBe("LOBBY");
    expect(lobbySnap.results).toBeNull();
    expect(lobbySnap.sheets).toHaveLength(2);
    // Sheets are genuinely reset — no leftover penalties/crosses from the finished game.
    for (const sheet of lobbySnap.sheets) {
      expect(sheet.penalties).toBe(0);
      for (const color of ["red", "yellow", "green", "blue"] as const) {
        expect(sheet.rows[color].crossedValues).toHaveLength(0);
      }
    }

    // Both clients should have landed back in the lobby too.
    const bobLobbySnap = await bob.waitForSnapshot(
      (s) => s.lobbyState === "LOBBY",
    );
    expect(bobLobbySnap.sheets).toHaveLength(2);

    // And a fresh game can actually be started.
    alice.send({ type: "start_game" });
    const newGameWhite = await alice.waitForSnapshot(
      (s) => s.phase === "WHITE",
    );
    expect(newGameWhite.lobbyState).toBe("IN_PROGRESS");
    expect(newGameWhite.turnSeq).toBe(0);
  });
});
