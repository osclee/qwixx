import type { Color, DiceRoll } from "../net/protocol";
import { ROW_ORDER } from "../rowLayout";
import { Die } from "./Die";

interface DiceTrayProps {
  roll: DiceRoll | null;
  diceInPlay: Color[];
  removedColors: Color[];
  /** Briefly true right after a roll lands, to fade the dice in for onlookers. */
  justRevealed?: boolean;
}

export function DiceTray({
  roll,
  diceInPlay,
  removedColors,
  justRevealed,
}: DiceTrayProps) {
  const inPlay = new Set(diceInPlay);
  return (
    <div className={`dice-tray ${justRevealed ? "dice-tray--revealed" : ""}`}>
      <Die value={roll?.w1} variant="white" />
      <Die value={roll?.w2} variant="white" />
      {ROW_ORDER.map((color) => (
        <Die
          key={color}
          value={roll?.[color]}
          variant={color}
          faded={!inPlay.has(color)}
        />
      ))}
      {removedColors.length > 0 && (
        <span className="dice-tray__removed-note">
          {removedColors.map((c) => c[0]?.toUpperCase()).join(", ")} locked
        </span>
      )}
    </div>
  );
}
