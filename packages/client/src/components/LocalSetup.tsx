import { useState } from "react";
import { LOCAL_MAX_PLAYERS, LOCAL_MIN_PLAYERS } from "../local/localGame";

interface LocalSetupProps {
  onStart: (names: string[]) => void;
  onBack: () => void;
}

export function LocalSetup({ onStart, onBack }: LocalSetupProps) {
  const [names, setNames] = useState<string[]>(["", ""]);

  function updateName(i: number, value: string) {
    setNames((prev) => prev.map((n, idx) => (idx === i ? value : n)));
  }

  function addPlayer() {
    setNames((prev) =>
      prev.length >= LOCAL_MAX_PLAYERS ? prev : [...prev, ""],
    );
  }

  function removePlayer(i: number) {
    setNames((prev) =>
      prev.length <= LOCAL_MIN_PLAYERS
        ? prev
        : prev.filter((_, idx) => idx !== i),
    );
  }

  const trimmed = names.map((n) => n.trim());
  const allFilled = trimmed.every((n) => n.length > 0);
  const hasDuplicate =
    new Set(trimmed.map((n) => n.toLowerCase())).size !== trimmed.length;
  const canStart = allFilled && !hasDuplicate;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onStart(trimmed);
  }

  return (
    <div className="lobby">
      <div className="lobby__card">
        <h1 className="brand-title">
          <span aria-hidden="true">🎲</span> Qwixx
        </h1>
        <p className="lobby__status">
          Local multiplayer — pass the device around the table
        </p>

        <form onSubmit={submit} className="lobby__form">
          {names.map((name, i) => (
            <label key={i}>
              Player {i + 1}
              <div className="local-setup__player-row">
                <input
                  value={name}
                  maxLength={20}
                  onChange={(e) => updateName(i, e.target.value)}
                  placeholder={`Player ${i + 1} name`}
                />
                {names.length > LOCAL_MIN_PLAYERS && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => removePlayer(i)}
                    aria-label={`Remove player ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </label>
          ))}

          {names.length < LOCAL_MAX_PLAYERS && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={addPlayer}
            >
              + Add player
            </button>
          )}

          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canStart}
          >
            Start local game
          </button>
        </form>

        {hasDuplicate && allFilled && (
          <p className="lobby__error">Player names must be unique.</p>
        )}

        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}
