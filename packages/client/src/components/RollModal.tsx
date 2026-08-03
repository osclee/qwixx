import { useEffect, useState } from "react";
import type { DiceRoll } from "../net/protocol";
import { ROW_ORDER } from "../rowLayout";
import { Timer } from "./Timer";
import { Die } from "./Die";

interface RollModalProps {
  /** True while phase === 'ROLLING' (still waiting on the roll). */
  waiting: boolean;
  /** True for a brief window right after rolling, before the modal closes. */
  revealing: boolean;
  roll: DiceRoll | null;
  phaseDeadline: number | null;
  serverNow: number;
  onRoll: () => void;
}

/**
 * Shown only to the active player. While waiting, prompts them to roll
 * (or lets the server's own timer auto-roll after 10s — nobody loses their
 * turn over it, see table.ts beginRoll). Once rolled, shows the result
 * briefly before Table.tsx stops rendering this component.
 */
export function RollModal({
  waiting,
  revealing,
  roll,
  phaseDeadline,
  serverNow,
  onRoll,
}: RollModalProps) {
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    if (waiting) setClicked(false);
  }, [waiting]);

  return (
    <div className="roll-modal">
      <div className="roll-modal__card">
        {waiting ? (
          <>
            <h2>Your roll!</h2>
            <Timer phaseDeadline={phaseDeadline} serverNow={serverNow} />
            <button
              type="button"
              className="btn btn--primary roll-modal__button"
              disabled={clicked}
              onClick={() => {
                setClicked(true);
                onRoll();
              }}
            >
              {clicked ? "Rolling…" : "Roll dice"}
            </button>
          </>
        ) : (
          revealing &&
          roll && (
            <>
              <h2>You rolled</h2>
              <div className="roll-modal__dice">
                <Die value={roll.w1} variant="white" />
                <Die value={roll.w2} variant="white" />
                {ROW_ORDER.filter((c) => roll[c] !== undefined).map((c) => (
                  <Die key={c} value={roll[c]} variant={c} />
                ))}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
