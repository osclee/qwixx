import type { Color, PublicSheet } from "../net/protocol";
import { ROW_DISPLAY_VALUES, ROW_LABEL, ROW_ORDER } from "../rowLayout";

interface ScoreSheetProps {
  sheet: PublicSheet;
  compact?: boolean;
  /** Values currently clickable per row (own sheet only, computed client-side for optimistic highlighting). */
  legalValues?: Partial<Record<Color, Set<number>>>;
  onCellClick?: (color: Color, value: number) => void;
}

export function ScoreSheet({ sheet, compact, legalValues, onCellClick }: ScoreSheetProps) {
  return (
    <div className={`score-sheet ${compact ? "score-sheet--compact" : ""}`}>
      <div className="score-sheet__header">
        <span className={`nickname ${sheet.connected ? "" : "nickname--offline"}`}>
          {sheet.nickname}
          {sheet.isBot && <span className="badge">CPU</span>}
          {!sheet.connected && <span className="offline-dot" title="Disconnected"> ● </span>}
        </span>
      </div>
      {ROW_ORDER.map((color) => {
        const row = sheet.rows[color];
        const legal = legalValues?.[color];
        const values = ROW_DISPLAY_VALUES[color];
        const crossedSet = new Set(row.crossedValues);
        return (
          <div className={`row row--${color}`} key={color}>
            <span className="row__label">{ROW_LABEL[color]}</span>
            <div className="row__cells">
              {values.map((value, i) => {
                const isTerminal = i === values.length - 1;
                const crossed = crossedSet.has(value);
                const isLegal = !crossed && legal?.has(value) && !row.locked;
                return (
                  <button
                    key={value}
                    type="button"
                    className={[
                      "cell",
                      isTerminal ? "cell--terminal" : "",
                      crossed ? "cell--crossed" : "",
                      isLegal ? "cell--legal" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!isLegal || !onCellClick}
                    onClick={() => onCellClick?.(color, value)}
                  >
                    {crossed ? "✕" : value}
                  </button>
                );
              })}
              <span className={`lock ${row.locked ? "lock--earned" : ""}`} title="Lock">
                🔒
              </span>
            </div>
            <span className="row__score">{row.score}</span>
          </div>
        );
      })}
      <div className="penalties">
        <span className="penalties__label">Penalties</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`penalty-box ${i < sheet.penalties ? "penalty-box--crossed" : ""}`} />
        ))}
      </div>
    </div>
  );
}
