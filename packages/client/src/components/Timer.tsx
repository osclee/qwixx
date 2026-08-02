import { useEffect, useState } from "react";

interface TimerProps {
  phaseDeadline: number | null;
  serverNow: number;
}

export function Timer({ phaseDeadline, serverNow }: TimerProps) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (phaseDeadline === null) {
      setRemainingMs(null);
      return;
    }
    // Anchor to the client's own clock at the moment this deadline was
    // received, rather than trusting absolute clock agreement with the
    // server — only the server-computed *duration* (deadline - serverNow)
    // needs to be accurate, not clock sync.
    const totalDurationMs = phaseDeadline - serverNow;
    const startedAt = Date.now();
    const tick = () => setRemainingMs(Math.max(0, totalDurationMs - (Date.now() - startedAt)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phaseDeadline, serverNow]);

  if (remainingMs === null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  return <span className={`timer ${seconds <= 10 ? "timer--low" : ""}`}>{seconds}s</span>;
}
