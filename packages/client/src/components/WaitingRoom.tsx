import { useState } from "react";
import type { BotDifficulty, SnapshotMessage } from "../net/protocol";
import type { GameConnection } from "../net/socket";
import { DiceIcon } from "./Icons";

const MAX_SEATS = 5;

interface WaitingRoomProps {
  conn: GameConnection;
  snapshot: SnapshotMessage;
  you: string;
}

export function WaitingRoom({ conn, snapshot, you }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("easy");
  const isHost = snapshot.hostPlayerId === you;
  const canStart = isHost && snapshot.sheets.length >= 2;
  const tableFull = snapshot.sheets.length >= MAX_SEATS;

  function copyCode() {
    navigator.clipboard?.writeText(snapshot.roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="lobby">
      <div className="lobby__card">
        <h1 className="brand-title">
          <span aria-hidden="true">
            <DiceIcon />
          </span>{" "}
          Qwixx
        </h1>
        <p className="waiting-room__room-code-label">Room code</p>
        <button
          type="button"
          className="waiting-room__room-code"
          onClick={copyCode}
          title="Click to copy"
        >
          {snapshot.roomCode}
          {copied && <span className="waiting-room__copied"> copied!</span>}
        </button>

        <ul className="waiting-room__players">
          {snapshot.sheets.map((s) => (
            <li key={s.playerId}>
              {s.nickname}
              {s.isBot && <span className="badge">CPU</span>}
              {s.playerId === snapshot.hostPlayerId && (
                <span className="badge">host</span>
              )}
              {s.playerId === you && (
                <span className="badge badge--you">you</span>
              )}
              {isHost && s.isBot && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small waiting-room__remove-bot"
                  onClick={() => conn.removeBot(s.playerId)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {isHost && (
          <div className="waiting-room__add-bot">
            <select
              className="add-bot__select"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}
              aria-label="Bot difficulty"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <button
              type="button"
              className="btn btn--small"
              disabled={tableFull}
              onClick={() => conn.addBot(difficulty)}
            >
              Add CPU
            </button>
          </div>
        )}

        {isHost ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canStart}
            onClick={() => conn.startGame()}
          >
            {canStart ? "Start game" : "Need at least 2 players"}
          </button>
        ) : (
          <p className="waiting-room__waiting">
            Waiting for the host to start…
          </p>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => conn.leaveTable()}
        >
          Leave
        </button>
      </div>
    </div>
  );
}
