import { useEffect, useState } from "react";
import type { GameHistoryResponse } from "../net/protocol";
import { RankIcon, TicketIcon } from "./Icons";

interface GameHistoryProps {
  roomCode: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; history: GameHistoryResponse };

export function GameHistory({ roomCode }: GameHistoryProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tables/${encodeURIComponent(roomCode)}/history`)
      .then((res) => {
        if (!res.ok) throw new Error("No finished game found for that room.");
        return res.json() as Promise<GameHistoryResponse>;
      })
      .then((history) => {
        if (!cancelled) setState({ status: "ready", history });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  return (
    <div className="game-history">
      <div className="game-history__card">
        <h2 className="game-history__title">
          <TicketIcon /> Game history — {roomCode}
        </h2>
        {state.status === "loading" && (
          <p className="game-history__status">Loading…</p>
        )}
        {state.status === "error" && (
          <p className="game-history__status">{state.message}</p>
        )}
        {state.status === "ready" && (
          <>
            <p className="game-history__status">
              Finished {new Date(state.history.createdAt).toLocaleString()}
            </p>
            <div className="game-history__table-wrap">
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
                  {[...state.history.results]
                    .sort((a, b) => a.rank - b.rank)
                    .map((r) => (
                      <tr
                        key={r.playerId}
                        className={
                          r.rank === 1 ? "game-history__winner" : ""
                        }
                      >
                        <td className="game-history__rank">
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
          </>
        )}
        <a className="btn btn--primary game-history__back" href="/">
          Back to Qwixx
        </a>
      </div>
    </div>
  );
}
