import { useMemo, useState } from "react";
import type {
  ChatMessage,
  Color,
  EventMessage,
  SnapshotMessage,
} from "../net/protocol";
import type { ConnectionStatus, GameConnection } from "../net/socket";
import { legalColorCombos, legalWhiteRows } from "../net/legalMoves";
import { useJustRevealed } from "../net/useJustRevealed";
import { ScoreSheet } from "./ScoreSheet";
import { DiceTray } from "./DiceTray";
import { TurnBar } from "./TurnBar";
import { EventLog } from "./EventLog";
import { ChatPanel } from "./ChatPanel";
import { GameOver } from "./GameOver";
import { RollModal } from "./RollModal";
import { DiceIcon } from "./Icons";

interface TableProps {
  conn: GameConnection;
  snapshot: SnapshotMessage;
  you: string;
  events: EventMessage[];
  chatMessages: ChatMessage[];
  status: ConnectionStatus;
}

const CONNECTION_BANNER_LABEL: Partial<Record<ConnectionStatus, string>> = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting… your moves won't go through until this reconnects",
  closed: "Disconnected — refresh to reconnect",
};

export function Table({
  conn,
  snapshot,
  you,
  events,
  chatMessages,
  status,
}: TableProps) {
  const connected = status === "open";
  const ownSheet = snapshot.sheets.find((s) => s.playerId === you);
  const opponents = snapshot.sheets.filter((s) => s.playerId !== you);
  const isActive = snapshot.activePlayerId === you;
  const isHost = snapshot.hostPlayerId === you;
  const youAnsweredWhite = snapshot.whiteSubmitted.includes(you);
  const isRolling = snapshot.phase === "ROLLING";
  const activeNickname = snapshot.sheets.find(
    (s) => s.playerId === snapshot.activePlayerId,
  )?.nickname;
  const justRevealed = useJustRevealed(snapshot.phase, snapshot.turnSeq);
  const [gameOverDismissed, setGameOverDismissed] = useState(false);

  const colorCombos = useMemo(() => {
    if (!ownSheet || snapshot.phase !== "COLOR" || !isActive || !snapshot.roll)
      return [];
    return legalColorCombos(ownSheet, snapshot.roll, snapshot.diceInPlay);
  }, [ownSheet, snapshot.phase, isActive, snapshot.roll, snapshot.diceInPlay]);

  const legalValues = useMemo(() => {
    // No legal moves while disconnected -- nothing sent would reach the
    // server anyway, so don't show cells as clickable.
    if (!ownSheet || !connected) return {};
    const map: Partial<Record<Color, Set<number>>> = {};

    if (snapshot.phase === "WHITE" && !youAnsweredWhite && snapshot.roll) {
      const sumWhite = snapshot.roll.w1 + snapshot.roll.w2;
      for (const color of legalWhiteRows(ownSheet, sumWhite)) {
        map[color] = new Set([sumWhite]);
      }
    }

    if (snapshot.phase === "COLOR" && isActive) {
      for (const combo of colorCombos) {
        const set = map[combo.color] ?? new Set<number>();
        set.add(combo.value);
        map[combo.color] = set;
      }
    }

    return map;
  }, [
    ownSheet,
    connected,
    snapshot.phase,
    snapshot.roll,
    youAnsweredWhite,
    isActive,
    colorCombos,
  ]);

  function handleCellClick(color: Color, value: number) {
    if (!connected) return;
    if (snapshot.phase === "WHITE" && !youAnsweredWhite) {
      conn.submitWhite({ kind: "cross", color, value });
      return;
    }
    if (snapshot.phase === "COLOR" && isActive) {
      const combo = colorCombos.find(
        (c) => c.color === color && c.value === value,
      );
      if (combo)
        conn.submitColor({
          kind: "cross",
          whiteDie: combo.whiteDie,
          color,
          value,
        });
    }
  }

  const bannerLabel = CONNECTION_BANNER_LABEL[status];

  return (
    <div className="table">
      {bannerLabel && (
        <div className="connection-banner" role="status">
          {bannerLabel}
        </div>
      )}
      <header className="table__header">
        <div className="table__brand">
          <span className="table__logo" aria-hidden="true">
            <DiceIcon />
          </span>
          <span className="table__room-code">Room {snapshot.roomCode}</span>
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
          {isHost && !snapshot.daily && snapshot.phase !== "FINISHED" && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                if (
                  window.confirm(
                    "End the game now for everyone? Sheets will be scored as they stand.",
                  )
                ) {
                  conn.endGame();
                }
              }}
            >
              End game
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => conn.leaveTable()}
          >
            Leave
          </button>
        </div>
      </header>

      {isActive &&
        (isRolling || justRevealed) &&
        snapshot.phase !== "FINISHED" && (
          <RollModal
            waiting={isRolling}
            revealing={justRevealed && !isRolling}
            roll={snapshot.roll}
            phaseDeadline={snapshot.phaseDeadline}
            serverNow={snapshot.serverNow}
            disabled={!connected}
            onRoll={() => conn.rollDice()}
          />
        )}

      {snapshot.phase !== "FINISHED" &&
        (isRolling ? (
          <p className="dice-tray__waiting">
            {isActive ? "Your roll!" : `Waiting for ${activeNickname} to roll…`}
          </p>
        ) : (
          <p className="dice-tray__rolled-by">
            {isActive ? "You rolled:" : `${activeNickname} rolled:`}
          </p>
        ))}

      <DiceTray
        roll={snapshot.roll}
        diceInPlay={snapshot.diceInPlay}
        removedColors={snapshot.removedColors}
        justRevealed={!isActive && justRevealed}
      />

      {snapshot.phase !== "FINISHED" && (
        <TurnBar
          snapshot={snapshot}
          you={you}
          disabled={!connected}
          onPassWhite={() => conn.submitWhite({ kind: "pass" })}
          onPassColor={() => conn.submitColor({ kind: "pass" })}
        />
      )}

      <div className="table__body">
        <div className="table__column">
          <div className="table__own-sheet">
            {ownSheet && (
              <ScoreSheet
                sheet={ownSheet}
                legalValues={legalValues}
                onCellClick={handleCellClick}
              />
            )}
          </div>

          {!snapshot.daily && (
            <ChatPanel conn={conn} messages={chatMessages} you={you} />
          )}
        </div>

        <div className="table__column">
          <div className="table__opponents">
            {opponents.map((s) => (
              <ScoreSheet key={s.playerId} sheet={s} compact />
            ))}
          </div>

          <EventLog events={events} />
        </div>
      </div>

      {snapshot.phase === "FINISHED" &&
        snapshot.results &&
        !gameOverDismissed && (
          <GameOver
            results={snapshot.results}
            you={you}
            isHost={snapshot.hostPlayerId === you}
            {...(ownSheet ? { ownSheet } : {})}
            {...(snapshot.daily
              ? { daily: snapshot.daily }
              : { roomCode: snapshot.roomCode })}
            onClose={() => setGameOverDismissed(true)}
            onNewGame={() => conn.newGame()}
          />
        )}
    </div>
  );
}
