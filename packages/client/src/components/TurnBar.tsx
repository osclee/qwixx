import type { SnapshotMessage } from "../net/protocol";
import { Timer } from "./Timer";

interface TurnBarProps {
  snapshot: SnapshotMessage;
  you: string;
  onPassWhite: () => void;
  onPassColor: () => void;
}

const PHASE_LABEL: Record<SnapshotMessage["phase"], string> = {
  LOBBY: "Waiting to start",
  ROLLING: "Rolling…",
  WHITE: "White dice — anyone may cross the sum",
  COLOR: "Active player's color combo",
  RESOLVE: "Resolving turn…",
  FINISHED: "Game over",
};

const PHASE_ICON: Record<SnapshotMessage["phase"], string> = {
  LOBBY: "⏳",
  ROLLING: "🎲",
  WHITE: "⚪",
  COLOR: "🎨",
  RESOLVE: "🔄",
  FINISHED: "🏁",
};

export function TurnBar({ snapshot, you, onPassWhite, onPassColor }: TurnBarProps) {
  const activeSheet = snapshot.sheets.find((s) => s.playerId === snapshot.activePlayerId);
  const youAnsweredWhite = snapshot.whiteSubmitted.includes(you);
  const isActive = snapshot.activePlayerId === you;

  return (
    <div className="turn-bar">
      <div className="turn-bar__info">
        <span className={`turn-bar__phase turn-bar__phase--${snapshot.phase.toLowerCase()}`}>
          <span className="turn-bar__phase-icon" aria-hidden="true">
            {PHASE_ICON[snapshot.phase]}
          </span>
          {PHASE_LABEL[snapshot.phase]}
        </span>
        {activeSheet && snapshot.phase !== "FINISHED" && (
          <span className="turn-bar__active">
            Active: <strong>{activeSheet.nickname}</strong>
            {isActive && " (you)"}
          </span>
        )}
        <Timer phaseDeadline={snapshot.phaseDeadline} serverNow={snapshot.serverNow} />
      </div>
      <div className="turn-bar__actions">
        {snapshot.phase === "WHITE" && !youAnsweredWhite && (
          <button type="button" className="btn btn--pass" onClick={onPassWhite}>
            Pass white sum
          </button>
        )}
        {snapshot.phase === "COLOR" && isActive && (
          <button type="button" className="btn btn--pass" onClick={onPassColor}>
            Pass color combo
          </button>
        )}
      </div>
    </div>
  );
}
