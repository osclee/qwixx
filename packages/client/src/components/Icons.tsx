/**
 * Hand-coded SVG icon set replacing emoji, styled as simple neon line/badge
 * icons to match the urban night-city theme. Every icon is decorative —
 * meaning is always carried by adjacent text or a parent aria-label — so
 * each renders with aria-hidden and inherits sizing/color from its parent
 * via the shared `.icon` CSS class (1em square, currentColor).
 */

interface IconProps {
  className?: string;
}

function base(className: string | undefined, extra?: string) {
  return ["icon", extra, className].filter(Boolean).join(" ");
}

/** Brand mark + the ROLLING turn phase. */
export function DiceIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="16" cy="16" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** Daily Challenge. */
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Rank #1 in results tables. */
export function TrophyIcon({ className }: IconProps) {
  return (
    <svg className={base(className)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 3h12v2h2a1 1 0 0 1 1 1v1a5 5 0 0 1-5 5h-.1A6 6 0 0 1 13 15.9V18h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.1A6 6 0 0 1 8.1 12H8a5 5 0 0 1-5-5V6a1 1 0 0 1 1-1h2V3Zm-2 4a3 3 0 0 0 3 3V6H4v1Zm14 1a3 3 0 0 0 2-3V6h-2v4Z" />
    </svg>
  );
}

/** Rank #2/#3 in results tables — color set via icon--silver / icon--bronze. */
export function MedalIcon({ className }: IconProps) {
  return (
    <svg className={base(className)} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 2h3l-2 6-3-2Z" fill="currentColor" opacity="0.65" />
      <path d="M16 2h-3l2 6 3-2Z" fill="currentColor" opacity="0.65" />
      <circle cx="12" cy="14" r="7" fill="currentColor" />
      <circle cx="12" cy="14" r="4" fill="none" stroke="var(--bg)" strokeWidth="1.5" />
    </svg>
  );
}

/** Rank badge shared by GameOver + GameHistory results tables. */
export function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <TrophyIcon className="icon--gold" />;
  if (rank === 2) return <MedalIcon className="icon--silver" />;
  if (rank === 3) return <MedalIcon className="icon--bronze" />;
  return <>#{rank}</>;
}

/** Success states — styled like a pedestrian "walk" signal box. */
export function WalkSignalIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className, "icon--success")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 12.5l3 3 7-7" />
    </svg>
  );
}

/** Failure states — styled like a "don't walk" signal box. */
export function HandSignalIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className, "icon--fail")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  );
}

/** Copy score to clipboard. */
export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" fill="currentColor" stroke="none" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

/** Local pass-and-play (arcade-cabinet controller). */
export function ControllerIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8h5a7 7 0 0 1 7 7 3 3 0 0 1-3 3c-1 0-1.7-.5-2.3-1.3L11.5 15h-3l-1.2 1.7C6.7 17.5 6 18 5 18a3 3 0 0 1-3-3 7 7 0 0 1 4-6.3Z" />
      <path d="M7.5 9.5v2M6.5 10.5h2" />
      <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Close / remove buttons. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

/** Game over / FINISHED turn phase. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3v18" />
      <path d="M5 4h6l1 2h6l-2 3 2 3h-6l-1-2H5Z" fill="currentColor" opacity="0.85" stroke="none" />
    </svg>
  );
}

/** Row-lock indicator on the score sheet. */
export function LockIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

/** COLOR turn phase — a graffiti spray can. */
export function SprayCanIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="8" width="9" height="13" rx="2" />
      <path d="M9.5 8V5h3l0.8 3" />
      <path d="M3.5 4.5l1.4 1.4M3.5 8h2M6 2.5l1 1" />
    </svg>
  );
}

/** RESOLVE turn phase. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.6" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

/** LOBBY turn phase (rarely rendered, kept for completeness). */
export function HourglassIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
    </svg>
  );
}

/** WHITE turn phase — the white die's own pip. */
export function WhiteDotIcon({ className }: IconProps) {
  return (
    <svg className={base(className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="currentColor" stroke="var(--border)" strokeWidth="1.5" />
    </svg>
  );
}

/** Game history — a subway/metro ticket. */
export function TicketIcon({ className }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 1 0 0 4v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a2 2 0 1 0 0-4Z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  );
}
