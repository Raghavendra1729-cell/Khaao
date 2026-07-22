import type { ReactNode } from 'react';
import type { MenuItemStatus, OrderItemStatus, OrderStatus } from '../../api/types';

type Tone = 'moss' | 'turmeric' | 'stamp' | 'neutral' | 'steel';

const TONE_STYLES: Record<Tone, string> = {
  moss: 'border-brand/30 bg-brand-light text-brand-dark',
  turmeric: 'border-turmeric/40 bg-turmeric-pale text-turmeric-deep',
  stamp: 'border-stamp/40 bg-stamp-light text-stamp-dark',
  neutral: 'border-edge bg-edge/40 text-ink/60',
  steel: 'border-steel-dark/25 bg-steel text-steel-dark',
};

/** A small rectangular "chit tag" — a printed label stuck on a ledger row,
 * not a rounded SaaS pill. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider leading-none ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

const MENU_STATUS_META: Record<MenuItemStatus, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'moss' },
  time_limited: { label: 'Time-limited', tone: 'turmeric' },
  out_of_stock: { label: 'Out of stock', tone: 'stamp' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
};

export function MenuStatusBadge({ status }: { status: MenuItemStatus }) {
  const meta = MENU_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'steel' },
  preparing: { label: 'Preparing', tone: 'turmeric' },
  partially_ready: { label: 'Partially ready', tone: 'turmeric' },
  ready: { label: 'Ready', tone: 'stamp' },
  awaiting_payment: { label: 'Collect payment', tone: 'turmeric' },
  completed: { label: 'Paid', tone: 'moss' },
  rejected: { label: 'Rejected', tone: 'stamp' },
  expired: { label: 'Expired', tone: 'stamp' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ORDER_ITEM_STATUS_META: Record<OrderItemStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting review', tone: 'steel' },
  queued: { label: 'Cooking', tone: 'turmeric' },
  allocated: { label: 'Ready', tone: 'stamp' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  handed_over: { label: 'Handed over', tone: 'moss' },
};

export function OrderItemStatusBadge({ status }: { status: OrderItemStatus }) {
  const meta = ORDER_ITEM_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
