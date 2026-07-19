import { useId, type CSSProperties } from 'react';
import type { OrderStatus } from '../api/types';

/**
 * The canteen counter stamps a paper chit as it moves down the line — order
 * received, cooking, ready, paid. This is that, in the browser: ink marks
 * that land on the ticket as the real order state changes, instead of a
 * generic dot-progress bar. Each stamp's ink color is fixed (not a
 * "current step" highlight), because a real stamp doesn't change color once
 * it's pressed — only whether it's landed yet.
 */
const STAMPS: { key: string; label: string; ink: string; rot: string }[] = [
  { key: 'in', label: 'RECEIVED', ink: 'border-ink text-ink', rot: '-4deg' },
  { key: 'cooking', label: 'COOKING', ink: 'border-turmeric-deep text-turmeric-deep', rot: '3deg' },
  { key: 'ready', label: 'READY', ink: 'border-stamp text-stamp', rot: '-6deg' },
  { key: 'paid', label: 'PAID', ink: 'border-brand-dark text-brand-dark', rot: '5deg' },
];

function landedCount(status: OrderStatus): number {
  switch (status) {
    case 'submitted':
      return 1;
    case 'preparing':
    case 'partially_ready':
      return 2;
    case 'ready':
    case 'awaiting_payment':
      // The PAID stamp lands only once payment is actually collected — during
      // awaiting_payment everything is handed over but nothing's paid yet,
      // so the "Pay ₹X at the counter" banner carries that message instead.
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

const VOID_LABEL: Partial<Record<OrderStatus, string>> = {
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
};

const STAMP_BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-full border-2 bg-current/10 px-2.5 py-1.5 font-display text-[10px] font-bold uppercase tracking-wider';

export function StatusStamps({ status }: { status: OrderStatus }) {
  const filterId = useId();
  const voidLabel = VOID_LABEL[status];

  if (voidLabel) {
    return (
      <div className="flex items-center justify-center py-2">
        <StampFilterDefs id={filterId} />
        <span
          className={`${STAMP_BASE} -rotate-6 border-stamp px-4 py-2 text-sm text-stamp`}
          style={{ filter: `url(#${filterId})` }}
        >
          {voidLabel}
        </span>
      </div>
    );
  }

  const landed = landedCount(status);

  return (
    <div className="flex items-center justify-between gap-1.5">
      <StampFilterDefs id={filterId} />
      {STAMPS.map((s, i) => {
        const isLanded = i < landed;
        return (
          <span
            key={s.key}
            className={
              isLanded
                ? `${STAMP_BASE} animate-stamp ${s.ink}`
                : `${STAMP_BASE} border-dashed border-edge bg-transparent text-ink/25`
            }
            style={
              isLanded ? ({ '--stamp-rot': s.rot, filter: `url(#${filterId})` } as CSSProperties) : undefined
            }
          >
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

/** SVG turbulence filter that gives each stamp its "pressed by hand, not
 * vector art" distressed ink edge. Defined once per group, referenced by
 * every mark in it via CSS `filter: url(#id)`. */
function StampFilterDefs({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" />
      </filter>
    </svg>
  );
}
