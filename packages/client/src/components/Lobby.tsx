import { useState } from "react";
import type { ConnectionStatus, GameConnection } from "../net/socket";
import type { ErrorMessage } from "../net/protocol";
import { getStoredNickname, getStoredSessionToken, setStoredNickname } from "../net/session";

interface LobbyProps {
  conn: GameConnection;
  status: ConnectionStatus;
  error: ErrorMessage | null;
}

export function Lobby({ conn, status, error }: LobbyProps) {
  const [nickname, setNickname] = useState(getStoredNickname());
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");

  const connected = status === "open";
  const trimmedNickname = nickname.trim();
  const canSubmit = connected && trimmedNickname.length > 0 && (mode === "create" || roomCode.trim().length >= 4);
  const canRejoin = connected && getStoredSessionToken() !== null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStoredNickname(trimmedNickname);
    if (mode === "create") {
      conn.createTable(trimmedNickname);
    } else {
      conn.joinTable(roomCode.trim(), trimmedNickname);
    }
  }

  return (
    <div className="lobby">
      <div className="lobby__card">
        <h1 className="brand-title">
          <span aria-hidden="true">🎲</span> Qwixx
        </h1>
        <p className="lobby__status">
          {status === "connecting" && "Connecting…"}
          {status === "reconnecting" && "Reconnecting…"}
          {status === "closed" && "Disconnected"}
          {status === "open" && "Connected"}
        </p>

        {canRejoin && (
          <button type="button" className="btn btn--primary lobby__rejoin" onClick={() => conn.rejoin()}>
            Rejoin game
          </button>
        )}

        <div className="lobby__tabs">
          <button
            type="button"
            className={mode === "create" ? "tab tab--active" : "tab"}
            onClick={() => setMode("create")}
          >
            New table
          </button>
          <button
            type="button"
            className={mode === "join" ? "tab tab--active" : "tab"}
            onClick={() => setMode("join")}
          >
            Join table
          </button>
        </div>

        <form onSubmit={submit} className="lobby__form">
          <label>
            Nickname
            <input
              value={nickname}
              maxLength={20}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your name"
            />
          </label>
          {mode === "join" && (
            <label>
              Room code
              <input
                value={roomCode}
                maxLength={8}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABCDE"
                className="room-code-input"
              />
            </label>
          )}
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {mode === "create" ? "Create table" : "Join table"}
          </button>
        </form>

        {error && <p className="lobby__error">{error.message}</p>}
      </div>
    </div>
  );
}
