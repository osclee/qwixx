import type { PublicResult } from "../net/protocol";

interface GameOverProps {
  results: PublicResult[];
  you: string;
  isHost: boolean;
  onClose: () => void;
  onNewGame: () => void;
}

const RANK_MEDAL: Record<number, string> = { 1: "🏆", 2: "🥈", 3: "🥉" };

export function GameOver({ results, you, isHost, onClose, onNewGame }: GameOverProps) {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  return (
    <div className="game-over" onClick={onClose}>
      <div className="game-over__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="game-over__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 className="game-over__title">
          <span aria-hidden="true">🏁</span> Game over
        </h2>
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
                className={[r.playerId === you ? "game-over__you" : "", r.rank === 1 ? "game-over__winner" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td className="game-over__rank">
                  {RANK_MEDAL[r.rank] ?? `#${r.rank}`}
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
        {isHost ? (
          <button type="button" className="btn btn--primary game-over__rematch" onClick={onNewGame}>
            Play again
          </button>
        ) : (
          <p className="game-over__waiting">Waiting for the host to start a new game…</p>
        )}
      </div>
    </div>
  );
}
