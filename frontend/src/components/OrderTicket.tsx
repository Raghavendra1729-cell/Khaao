import type { CSSProperties } from 'react';

interface OrderTicketProps {
  id: number;
  size?: 'md' | 'lg';
  /** Background color behind the ticket, used to punch the notch circles. Defaults to the card paper tone. */
  notchColor?: string;
  label?: string;
}

/**
 * The canteen "token" — every order gets a number a student calls out at the
 * counter. Styled like a torn ticket stub with punched side-notches so it
 * reads as a physical token, not just another card. Printed plain (ink on
 * card stock) — color comes later, from the status stamps applied to it.
 */
export function OrderTicket({ id, size = 'md', notchColor = '#eedfbb', label = 'TOKEN' }: OrderTicketProps) {
  const isLg = size === 'lg';
  const style = { '--ticket-notch-bg': notchColor } as CSSProperties;

  return (
    <div
      style={style}
      className={`ticket-notch relative mx-auto flex flex-col items-center rounded-2xl border-2 border-dashed border-ink/25 bg-paper shadow-ticket ${
        isLg ? 'w-64 px-6 py-5' : 'w-44 px-4 py-3'
      }`}
    >
      <span className={`font-display tracking-[0.2em] text-ink/45 ${isLg ? 'text-xs' : 'text-[10px]'}`}>
        {label}
      </span>
      <span
        className={`tabular font-display font-bold leading-none text-ink ${isLg ? 'mt-1 text-6xl' : 'mt-0.5 text-3xl'}`}
      >
        #{id}
      </span>
    </div>
  );
}
