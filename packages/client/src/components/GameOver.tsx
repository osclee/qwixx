import { useEffect, useMemo, useState } from "react";
import type { DailyStatus, PublicResult, PublicSheet } from "../net/protocol";
import { getDailyHistory, saveDailyResult } from "../net/daily";
import { buildShareText, copyToClipboard } from "../net/dailyShare";
import {
  CalendarIcon,
  ClipboardIcon,
  CloseIcon,
  FlagIcon,
  RankIcon,
  TrophyIcon,
  WalkSignalIcon,
} from "./Icons";

interface GameOverProps {
  results: PublicResult[];
  you: string;
  isHost: boolean;
  /** Omitted for local (pass-and-play) games and daily challenges, neither of which link to server-side history. */
  roomCode?: string;
  /** Present for daily-challenge games; drives the headline, hides rematch/history-link, and records the result. */
  daily?: DailyStatus;
  /** The player's own sheet — used to build the shareable emoji score for a daily challenge. */
  ownSheet?: PublicSheet;
  onClose: () => void;
  onNewGame: () => void;
}

export function GameOver({
  results,
  you,
  isHost,
  roomCode,
  daily,
  ownSheet,
  onClose,
  onNewGame,
}: GameOverProps) {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  const dailyResult = daily?.result ?? null;
  const [copied, setCopied] = useState(false);

  const shareText = useMemo(() => {
    if (!daily || !dailyResult || !ownSheet) return null;
    return buildShareText(
      {
        dateKey: daily.dateKey,
        won: dailyResult.won,
        playerTurns: dailyResult.won ? dailyResult.playerTurns : null,
        rows: {
          red: ownSheet.rows.red,
          yellow: ownSheet.rows.yellow,
          green: ownSheet.rows.green,
          blue: ownSheet.rows.blue,
        },
        penalties: ownSheet.penalties,
      },
      window.location.origin,
    );
  }, [daily, dailyResult, ownSheet]);

  async function handleCopy() {
    if (!shareText) return;
    const ok = await copyToClipboard(shareText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Record the daily result to localStorage exactly once per finished game
  // (keyed by dateKey, so a re-render or reconnect never double-records).
  useEffect(() => {
    if (!daily || !dailyResult || !ownSheet) return;
    saveDailyResult({
      dateKey: daily.dateKey,
      won: dailyResult.won,
      playerTurns: dailyResult.won ? dailyResult.playerTurns : null,
      playedAt: Date.now(),
      rows: {
        red: ownSheet.rows.red,
        yellow: ownSheet.rows.yellow,
        green: ownSheet.rows.green,
        blue: ownSheet.rows.blue,
      },
      penalties: ownSheet.penalties,
    });
  }, [daily, dailyResult, ownSheet]);

  if (daily && dailyResult) {
    const history = getDailyHistory();
    return (
      <div className="game-over" onClick={onClose}>
        <div className="game-over__card" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="game-over__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
          <h2 className="game-over__title">
            <CalendarIcon /> Daily Challenge
          </h2>
          <p className="game-over__daily-headline">
            {dailyResult.won ? (
              <>
                <TrophyIcon className="icon--gold" /> You beat the bot in{" "}
                {dailyResult.playerTurns} turn
                {dailyResult.playerTurns === 1 ? "" : "s"}!
              </>
            ) : (
              "The bot won today's challenge — try again tomorrow."
            )}
          </p>
          <div className="game-over__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Red</th>
                  <th>Yellow</th>
                  <th>Green</th>
                  <th>Blue</th>
                  <th>Penalties</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.playerId}
                    className={[
                      r.playerId === you ? "game-over__you" : "",
                      r.rank === 1 ? "game-over__winner" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="game-over__rank">
                      <RankIcon rank={r.rank} />
                    </td>
                    <td>{r.nickname}</td>
                    <td>{r.rowScores.red}</td>
                    <td>{r.rowScores.yellow}</td>
                    <td>{r.rowScores.green}</td>
                    <td>{r.rowScores.blue}</td>
                    <td>−{r.penaltyPoints}</td>
                    <td>
                      <strong>{r.total}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shareText && (
            <pre className="game-over__share-preview">{shareText}</pre>
          )}
          {history.length > 0 && (
            <details className="lobby__daily-history game-over__daily-history">
              <summary>Score history ({history.length})</summary>
              <ul>
                {history.slice(0, 14).map((entry) => (
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
          <div className="game-over__daily-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!shareText}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <WalkSignalIcon /> Copied!
                </>
              ) : (
                <>
                  <ClipboardIcon /> Copy score
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn--primary game-over__rematch"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game-over" onClick={onClose}>
      <div className="game-over__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="game-over__close"
          onClick={onClose}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <h2 className="game-over__title">
          <FlagIcon /> Game over
        </h2>
        <div className="game-over__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Red</th>
                <th>Yellow</th>
                <th>Green</th>
                <th>Blue</th>
                <th>Penalties</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.playerId}
                  className={[
                    r.playerId === you ? "game-over__you" : "",
                    r.rank === 1 ? "game-over__winner" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="game-over__rank">
                    <RankIcon rank={r.rank} />
                  </td>
                  <td>{r.nickname}</td>
                  <td>{r.rowScores.red}</td>
                  <td>{r.rowScores.yellow}</td>
                  <td>{r.rowScores.green}</td>
                  <td>{r.rowScores.blue}</td>
                  <td>−{r.penaltyPoints}</td>
                  <td>
                    <strong>{r.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isHost ? (
          <button
            type="button"
            className="btn btn--primary game-over__rematch"
            onClick={onNewGame}
          >
            Play again
          </button>
        ) : (
          <p className="game-over__waiting">
            Waiting for the host to start a new game…
          </p>
        )}
        {roomCode && (
          <a
            className="game-over__history-link"
            href={`/history/${roomCode}`}
            target="_blank"
            rel="noreferrer"
          >
            View full game history ↗
          </a>
        )}
      </div>
    </div>
  );
}
