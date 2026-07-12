import type { ReactNode } from 'react';
import type { MenuItemStatus, OrderItemStatus, OrderStatus } from '../api/types';

type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

const TONE_STYLES: Record<Tone, string> = {
  green: 'bg-brand-light text-brand-dark',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-black/5 text-ink/60',
  blue: 'bg-sky-100 text-sky-700',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-none ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

const MENU_STATUS_META: Record<MenuItemStatus, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'green' },
  time_limited: { label: 'Time-limited', tone: 'amber' },
  out_of_stock: { label: 'Out of stock', tone: 'red' },
  unavailable: { label: 'Unavailable', tone: 'gray' },
};

export function MenuStatusBadge({ status }: { status: MenuItemStatus }) {
  const meta = MENU_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Submitted', tone: 'blue' },
  preparing: { label: 'Preparing', tone: 'amber' },
  partially_ready: { label: 'Partially ready', tone: 'amber' },
  ready: { label: 'Ready', tone: 'green' },
  picked: { label: 'Picked up', tone: 'gray' },
  rejected: { label: 'Rejected', tone: 'red' },
  expired: { label: 'Expired', tone: 'red' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const ORDER_ITEM_STATUS_META: Record<OrderItemStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting review', tone: 'blue' },
  queued: { label: 'Cooking', tone: 'amber' },
  allocated: { label: 'Ready', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  handed_over: { label: 'Handed over', tone: 'gray' },
};

export function OrderItemStatusBadge({ status }: { status: OrderItemStatus }) {
  const meta = ORDER_ITEM_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
