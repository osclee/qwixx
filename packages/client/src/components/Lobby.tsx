import { useEffect, useState } from "react";
import type { ConnectionStatus, GameConnection } from "../net/socket";
import type { ErrorMessage } from "../net/protocol";
import {
  getStoredNickname,
  getStoredSessionToken,
  setStoredNickname,
} from "../net/session";
import {
  getDailyHistory,
  getTodayResult,
  msUntilNextUtcMidnight,
  todayDateKey,
} from "../net/daily";
import { buildShareText, copyToClipboard } from "../net/dailyShare";

interface LobbyProps {
  conn: GameConnection;
  status: ConnectionStatus;
  error: ErrorMessage | null;
  onPlayLocal: () => void;
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function Lobby({ conn, status, error, onPlayLocal }: LobbyProps) {
  const [nickname, setNickname] = useState(getStoredNickname());
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  // Re-render once a minute so the "next challenge in Xh Ym" countdown and
  // the day-rollover check (todayDateKey) stay live for a tab left open.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const connected = status === "open";
  const trimmedNickname = nickname.trim();
  const canSubmit =
    connected &&
    trimmedNickname.length > 0 &&
    (mode === "create" || roomCode.trim().length >= 4);
  const canRejoin = connected && getStoredSessionToken() !== null;

  const dateKey = todayDateKey();
  const todayResult = getTodayResult(dateKey);
  const dailyHistory = getDailyHistory();
  const canPlayDaily = connected && trimmedNickname.length > 0 && !todayResult;

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

  function playDaily() {
    if (!canPlayDaily) return;
    setStoredNickname(trimmedNickname);
    conn.createDailyTable(trimmedNickname);
  }

  async function copyTodayResult() {
    if (!todayResult) return;
    const ok = await copyToClipboard(
      buildShareText(todayResult, window.location.origin),
    );
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
          <button
            type="button"
            className="btn btn--primary lobby__rejoin"
            onClick={() => conn.rejoin()}
          >
            Rejoin game
          </button>
        )}

        <label className="lobby__nickname">
          Nickname
          <input
            value={nickname}
            maxLength={20}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Your name"
          />
        </label>

        <div className="lobby__daily">
          <h2 className="lobby__daily-title">
            <span aria-hidden="true">🗓️</span> Daily Challenge
          </h2>
          {todayResult ? (
            <div className="lobby__daily-done">
              <p>
                {todayResult.won
                  ? `✅ You beat today's bot in ${todayResult.playerTurns} turn${todayResult.playerTurns === 1 ? "" : "s"}!`
                  : "❌ The bot won today's challenge."}
              </p>
              <p className="lobby__daily-countdown">
                Next challenge in {formatCountdown(msUntilNextUtcMidnight())}
              </p>
              <button
                type="button"
                className="btn btn--ghost lobby__daily-btn"
                onClick={copyTodayResult}
              >
                {copied ? "✅ Copied!" : "📋 Copy score"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--primary lobby__daily-btn"
              disabled={!canPlayDaily}
              onClick={playDaily}
            >
              Play today's challenge
            </button>
          )}
          {dailyHistory.length > 0 && (
            <details className="lobby__daily-history">
              <summary>Score history ({dailyHistory.length})</summary>
              <ul>
                {dailyHistory.slice(0, 14).map((entry) => (
                  <li key={entry.dateKey}>
                    <span>{entry.dateKey}</span>
                    <span>
                      {entry.won ? `${entry.playerTurns} turns` : "Loss"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="lobby__divider">
          <span>or</span>
        </div>

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
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
          >
            {mode === "create" ? "Create table" : "Join table"}
          </button>
        </form>

        {error && <p className="lobby__error">{error.message}</p>}

        <div className="lobby__divider">
          <span>or</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost lobby__local-btn"
          onClick={onPlayLocal}
        >
          🎮 Local multiplayer (pass &amp; play)
        </button>
      </div>
    </div>
  );
}
