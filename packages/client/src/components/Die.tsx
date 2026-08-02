/** Standard 3x3 pip layout, positions numbered left-to-right/top-to-bottom (1-9). */
const PIP_LAYOUT: Record<number, readonly number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

interface DieProps {
  value: number | undefined;
  variant: "white" | "red" | "yellow" | "green" | "blue";
  faded?: boolean;
}

export function Die({ value, variant, faded }: DieProps) {
  const active = value !== undefined ? new Set(PIP_LAYOUT[value] ?? []) : null;
  return (
    <span className={`die die--${variant} ${faded ? "die--removed" : ""}`}>
      {active ? (
        <span className="die__pips">
          {Array.from({ length: 9 }, (_, i) => i + 1).map((pos) => (
            <span key={pos} className={`die__pip ${active.has(pos) ? "die__pip--on" : ""}`} />
          ))}
        </span>
      ) : (
        <span className="die__empty">–</span>
      )}
    </span>
  );
}
