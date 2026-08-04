import { useMemo, useState } from "react";
import type { Color } from "../net/protocol";
import { legalColorCombos, legalWhiteRows } from "../net/legalMoves";
import type { LocalGameStore, LocalSnapshot } from "../local/localGame";
import { ScoreSheet } from "./ScoreSheet";
import { DiceTray } from "./DiceTray";
import { GameOver } from "./GameOver";

interface LocalTableProps {
  store: LocalGameStore;
  snapshot: LocalSnapshot;
  onExit: () => void;
}

const PHASE_LABEL: Record<LocalSnapshot["phase"], string> = {
  LOBBY: "",
  ROLLING: "Rolling…",
  WHITE: "White dice — anyone may cross the sum",
  COLOR: "Active player's color combo",
  RESOLVE: "Resolving turn…",
  FINISHED: "Game over",
};

/**
 * The local (pass-and-play) equivalent of Table.tsx. Unlike the online
 * table there's no single "you" — every seat is physically at this device,
 * so every sheet is independently clickable when it's that player's turn
 * to answer (any seat during WHITE, only the active seat during COLOR).
 */
export function LocalTable({ store, snapshot, onExit }: LocalTableProps) {
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const activeSheet = snapshot.sheets.find(
    (s) => s.playerId === snapshot.activePlayerId,
  );
  const sumWhite = snapshot.roll ? snapshot.roll.w1 + snapshot.roll.w2 : null;

  const colorCombos = useMemo(() => {
    if (snapshot.phase !== "COLOR" || !snapshot.roll || !activeSheet)
      return [];
    return legalColorCombos(activeSheet, snapshot.roll, snapshot.diceInPlay);
  }, [snapshot.phase, snapshot.roll, activeSheet, snapshot.diceInPlay]);

  function legalValuesFor(
    playerId: string,
  ): Partial<Record<Color, Set<number>>> {
    const map: Partial<Record<Color, Set<number>>> = {};
    const sheet = snapshot.sheets.find((s) => s.playerId === playerId);
    if (!sheet) return map;

    if (
      snapshot.phase === "WHITE" &&
      sumWhite !== null &&
      !snapshot.whiteSubmitted.includes(playerId)
    ) {
      for (const color of legalWhiteRows(sheet, sumWhite)) {
        map[color] = new Set([sumWhite]);
      }
    }

    if (snapshot.phase === "COLOR" && playerId === snapshot.activePlayerId) {
      for (const combo of colorCombos) {
        const set = map[combo.color] ?? new Set<number>();
        set.add(combo.value);
        map[combo.color] = set;
      }
    }

    return map;
  }

  function handleCellClick(playerId: string, color: Color, value: number) {
    if (
      snapshot.phase === "WHITE" &&
      !snapshot.whiteSubmitted.includes(playerId)
    ) {
      store.submitWhite(playerId, { kind: "cross", color, value });
      return;
    }
    if (snapshot.phase === "COLOR" && playerId === snapshot.activePlayerId) {
      const combo = colorCombos.find(
        (c) => c.color === color && c.value === value,
      );
      if (combo) {
        store.submitColor({
          kind: "cross",
          whiteDie: combo.whiteDie,
          color,
          value,
        });
      }
    }
  }

  return (
    <div className="table local-table">
      <header className="table__header">
        <div className="table__brand">
          <span className="table__logo" aria-hidden="true">
            🎲
          </span>
          <span className="table__room-code">Local game</span>
        </div>
        <div className="table__header-actions">
          {snapshot.phase === "FINISHED" && gameOverDismissed && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setGameOverDismissed(false)}
            >
              View results
            </button>
          )}
          {snapshot.phase !== "FINISHED" && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                if (
                  window.confirm(
                    "End the game now? Sheets will be scored as they stand.",
                  )
                ) {
                  store.endGame();
                }
              }}
            >
              End game
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              if (
                window.confirm(
                  "Exit to the main menu? This local game will be lost.",
                )
              ) {
                onExit();
              }
            }}
          >
            Exit
          </button>
        </div>
      </header>

      {snapshot.phase !== "FINISHED" && (
        <div className="turn-bar local-table__turn-bar">
          <div className="turn-bar__info">
            <span
              className={`turn-bar__phase turn-bar__phase--${snapshot.phase.toLowerCase()}`}
            >
              {PHASE_LABEL[snapshot.phase]}
            </span>
            {activeSheet && (
              <span className="turn-bar__active">
                Active: <strong>{activeSheet.nickname}</strong>
              </span>
            )}
          </div>
          {snapshot.phase === "ROLLING" && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => store.rollDice()}
            >
              Roll dice
            </button>
          )}
        </div>
      )}

      {snapshot.phase !== "FINISHED" && (
        <>
          <p className="dice-tray__rolled-by">
            {snapshot.phase === "ROLLING"
              ? `Waiting for ${activeSheet?.nickname ?? "the active player"} to roll…`
              : "On the table:"}
          </p>
          <DiceTray
            roll={snapshot.roll}
            diceInPlay={snapshot.diceInPlay}
            removedColors={snapshot.removedColors}
          />
        </>
      )}

      <div className="local-table__sheets">
        {snapshot.sheets.map((sheet) => {
          const isActive = sheet.playerId === snapshot.activePlayerId;
          const answeredWhite = snapshot.whiteSubmitted.includes(
            sheet.playerId,
          );
          const showPassWhite = snapshot.phase === "WHITE" && !answeredWhite;
          const showPassColor = snapshot.phase === "COLOR" && isActive;
          return (
            <div
              key={sheet.playerId}
              className={`local-table__seat ${isActive ? "local-table__seat--active" : ""}`}
            >
              <ScoreSheet
                sheet={sheet}
                legalValues={legalValuesFor(sheet.playerId)}
                onCellClick={(color, value) =>
                  handleCellClick(sheet.playerId, color, value)
                }
              />
              {(showPassWhite || showPassColor) && (
                <button
                  type="button"
                  className="btn btn--pass local-table__pass"
                  onClick={() =>
                    showPassColor
                      ? store.submitColor({ kind: "pass" })
                      : store.submitWhite(sheet.playerId, { kind: "pass" })
                  }
                >
                  Pass
                </button>
              )}
            </div>
          );
        })}
      </div>

      {snapshot.phase === "FINISHED" &&
        snapshot.results &&
        !gameOverDismissed && (
          <GameOver
            results={snapshot.results}
            you=""
            isHost
            onClose={() => setGameOverDismissed(true)}
            onNewGame={() => store.newGame()}
          />
        )}
    </div>
  );
}
