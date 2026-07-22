import type { ReactNode } from 'react';

/**
 * A small set of quiet, hand-drawn-feel line glyphs for EmptyState's
 * optional icon slot (F16). Matches Layout.tsx's nav-icon stroke language
 * (viewBox 24, currentColor, 1.5px round strokes) rather than inventing a
 * new visual system — these are meant to disappear into the ink/25 tone the
 * slot already applies, not call attention to themselves.
 */
function GlyphBase({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** An empty plate — the menu has nothing on it right now. */
export function EmptyPlateIcon() {
  return (
    <GlyphBase>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" strokeDasharray="2 2.5" />
    </GlyphBase>
  );
}

/** A blank ticket stub, echoing OrderTicket's notched-chit shape — no
 * orders sitting on the counter yet. */
export function EmptyTicketIcon() {
  return (
    <GlyphBase>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M9 6v12" strokeDasharray="1.6 2" />
      <circle cx="9" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </GlyphBase>
  );
}

/** A dashed, unlit flame — nothing waiting on the cook right now. */
export function ColdFlameIcon() {
  return (
    <GlyphBase>
      <path
        d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.5-.8-2.5-.8-2.5C16.5 9.5 18 11 18 13.5A6 6 0 0 1 6 13.5C6 8.5 10.5 7 12 3z"
        strokeDasharray="2.2 2.2"
      />
    </GlyphBase>
  );
}

/** A short ledger line — no past orders on record yet. */
export function LedgerLineIcon() {
  return (
    <GlyphBase>
      <path d="M4 7h16" />
      <path d="M4 12h11" strokeDasharray="2 2.2" />
      <path d="M4 17h7" strokeDasharray="2 2.2" />
    </GlyphBase>
  );
}
