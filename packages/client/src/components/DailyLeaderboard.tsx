import { useEffect, useState } from "react";
import type { DailyLeaderboardResponse } from "../net/protocol";
import { fetchDailyLeaderboard } from "../net/dailyLeaderboard";
import { getStoredNickname } from "../net/session";

interface DailyLeaderboardProps {
  dateKey: string;
  onClose: () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DailyLeaderboardResponse };

const RANK_MEDAL: Record<number, string> = { 1: "🏆", 2: "🥈", 3: "🥉" };

/** Cross-player ranking (fewest turns to beat the bot wins) for a single UTC day's challenge, fetched from the server. */
export function DailyLeaderboard({ dateKey, onClose }: DailyLeaderboardProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const myNickname = getStoredNickname();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchDailyLeaderboard(dateKey)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  return (
    <div className="daily-leaderboard" onClick={onClose}>
      <div
        className="daily-leaderboard__card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="daily-leaderboard__close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <h2 className="daily-leaderboard__title">
          <span aria-hidden="true">🏆</span> Daily Leaderboard
        </h2>
        <p className="daily-leaderboard__date">{dateKey}</p>

        {state.status === "loading" && (
          <p className="daily-leaderboard__status">Loading…</p>
        )}
        {state.status === "error" && (
          <p className="daily-leaderboard__status">{state.message}</p>
        )}
        {state.status === "ready" && (
          <>
            <p className="daily-leaderboard__stat">
              {state.data.totalPlayers === 0
                ? "Nobody has played today's challenge yet — be the first!"
                : `${state.data.totalWinners} of ${state.data.totalPlayers} player${state.data.totalPlayers === 1 ? "" : "s"} beat the bot today.`}
            </p>
            {state.data.winners.length > 0 && (
              <div className="daily-leaderboard__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Player</th>
                      <th>Turns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.winners.map((w, i) => (
                      <tr
                        key={`${w.nickname}-${w.playedAt}-${i}`}
                        className={[
                          w.rank === 1 ? "daily-leaderboard__winner" : "",
                          w.nickname === myNickname
                            ? "daily-leaderboard__you"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td className="daily-leaderboard__rank">
                          {RANK_MEDAL[w.rank] ?? `#${w.rank}`}
                        </td>
                        <td>{w.nickname}</td>
                        <td>
                          <strong>{w.playerTurns}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <button
          type="button"
          className="btn btn--primary daily-leaderboard__done"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
