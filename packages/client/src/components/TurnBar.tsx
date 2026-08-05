import type { SnapshotMessage } from "../net/protocol";
import { Timer } from "./Timer";
import {
  DiceIcon,
  FlagIcon,
  HourglassIcon,
  RefreshIcon,
  SprayCanIcon,
  WhiteDotIcon,
} from "./Icons";

interface TurnBarProps {
  snapshot: SnapshotMessage;
  you: string;
  /** True while the connection isn't open -- disables the pass buttons since nothing would reach the server. */
  disabled?: boolean;
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

const PHASE_ICON: Record<
  SnapshotMessage["phase"],
  (props: { className?: string }) => JSX.Element
> = {
  LOBBY: HourglassIcon,
  ROLLING: DiceIcon,
  WHITE: WhiteDotIcon,
  COLOR: SprayCanIcon,
  RESOLVE: RefreshIcon,
  FINISHED: FlagIcon,
};

export function TurnBar({
  snapshot,
  you,
  disabled,
  onPassWhite,
  onPassColor,
}: TurnBarProps) {
  const activeSheet = snapshot.sheets.find(
    (s) => s.playerId === snapshot.activePlayerId,
  );
  const youAnsweredWhite = snapshot.whiteSubmitted.includes(you);
  const isActive = snapshot.activePlayerId === you;
  const PhaseIcon = PHASE_ICON[snapshot.phase];

  return (
    <div className="turn-bar">
      <div className="turn-bar__info">
        <span
          className={`turn-bar__phase turn-bar__phase--${snapshot.phase.toLowerCase()}`}
        >
          <span className="turn-bar__phase-icon" aria-hidden="true">
            <PhaseIcon />
          </span>
          {PHASE_LABEL[snapshot.phase]}
        </span>
        {activeSheet && snapshot.phase !== "FINISHED" && (
          <span className="turn-bar__active">
            Active: <strong>{activeSheet.nickname}</strong>
            {isActive && " (you)"}
          </span>
        )}
        <Timer
          phaseDeadline={snapshot.phaseDeadline}
          serverNow={snapshot.serverNow}
        />
      </div>
      <div className="turn-bar__actions">
        {snapshot.phase === "WHITE" && !youAnsweredWhite && (
          <button
            type="button"
            className="btn btn--pass"
            disabled={disabled}
            onClick={onPassWhite}
          >
            Pass white sum
          </button>
        )}
        {snapshot.phase === "COLOR" && isActive && (
          <button
            type="button"
            className="btn btn--pass"
            disabled={disabled}
            onClick={onPassColor}
          >
            Pass color combo
          </button>
        )}
      </div>
    </div>
  );
}
