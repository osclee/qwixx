import { useEffect, useRef, useState } from "react";
import type { Phase } from "./protocol";

const DEFAULT_DURATION_MS = 1500;

/**
 * True for a brief window immediately after `phase` transitions away from
 * ROLLING (i.e. the moment a roll lands) — drives the active player's
 * "you rolled" reveal in RollModal and the fade-in of the dice tray for
 * everyone else.
 */
export function useJustRevealed(phase: Phase, turnSeq: number, durationMs = DEFAULT_DURATION_MS): boolean {
  const [revealing, setRevealing] = useState(false);
  const prevPhaseRef = useRef<Phase>(phase);

  useEffect(() => {
    const wasRolling = prevPhaseRef.current === "ROLLING";
    const isRolling = phase === "ROLLING";
    prevPhaseRef.current = phase;

    if (wasRolling && !isRolling) {
      setRevealing(true);
      const timer = setTimeout(() => setRevealing(false), durationMs);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, turnSeq]);

  return revealing;
}
