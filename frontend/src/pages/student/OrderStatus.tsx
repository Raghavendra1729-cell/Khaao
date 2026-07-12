import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getActiveOrder, getOrderHistory } from '../../api/orders';
import { ApiError } from '../../api/client';
import type { Order, OrderStatus as OrderStatusType } from '../../api/types';
import { formatCountdown, formatDateTime, formatPrice, secondsUntil } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderTicket } from '../../components/OrderTicket';
import { OrderItemStatusBadge, OrderStatusBadge } from '../../components/StatusBadge';

const TIMELINE_STEPS: { status: OrderStatusType; label: string }[] = [
  { status: 'submitted', label: 'Submitted' },
  { status: 'preparing', label: 'Preparing' },
  { status: 'ready', label: 'Ready' },
  { status: 'picked', label: 'Picked up' },
];

function stepIndex(status: OrderStatusType): number {
  switch (status) {
    case 'submitted':
      return 0;
    case 'preparing':
    case 'partially_ready':
      return 1;
    case 'ready':
      return 2;
    case 'picked':
      return 3;
    default:
      return -1;
  }
}

function Timeline({ status }: { status: OrderStatusType }) {
  const current = stepIndex(status);
  return (
    <div className="flex items-center">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i < current || status === 'picked';
        const active = i === current && status !== 'picked';
        return (
          <div key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  done
                    ? 'border-brand bg-brand text-white'
                    : active
                      ? 'animate-soft-pulse border-brand bg-white text-brand'
                      : 'border-sage bg-white text-ink/30'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-[11px] font-semibold ${done || active ? 'text-ink' : 'text-ink/40'}`}>
                {step.label}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div className={`mx-1 h-0.5 flex-1 rounded ${i < current ? 'bg-brand' : 'bg-sage'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReadyBanner({ order }: { order: Order }) {
  const [remaining, setRemaining] = useState(() => secondsUntil(order.expires_at));

  useEffect(() => {
    setRemaining(secondsUntil(order.expires_at));
    const id = window.setInterval(() => setRemaining(secondsUntil(order.expires_at)), 1000);
    return () => window.clearInterval(id);
  }, [order.expires_at]);

  const expiringSoon = remaining <= 60;

  return (
    <div className="mb-5 flex w-full flex-col items-center gap-1 rounded-2xl bg-brand px-4 py-5 text-center text-white shadow-ticket">
      <p className="text-lg font-black tracking-tight">Ready — pick up within 15 min, pay at counter</p>
      <p className={`tabular text-3xl font-black ${expiringSoon ? 'animate-soft-pulse' : ''}`}>
        {remaining > 0 ? formatCountdown(remaining) : "Time's up"}
      </p>
      <p className="text-xs text-white/80">Show your token number at the counter.</p>
    </div>
  );
}

function ActiveOrderView({ order }: { order: Order }) {
  return (
    <Card className="p-5">
      {order.status === 'ready' && <ReadyBanner order={order} />}

      <div className="mb-5 flex justify-center">
        <OrderTicket id={order.id} size="lg" />
      </div>

      <div className="mb-6">
        <Timeline status={order.status} />
      </div>

      {order.status === 'partially_ready' && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm font-medium text-amber-800">
          Some items are ready — the rest are still cooking.
        </p>
      )}

      <div className="divide-y divide-sage">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <p className="font-semibold text-ink">{item.name}</p>
              <p className="tabular text-xs text-ink/50">
                {item.allocated_qty}/{item.qty} allocated · {formatPrice(item.price_each)} each
              </p>
            </div>
            <OrderItemStatusBadge status={item.status} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-sage pt-3">
        <span className="font-semibold text-ink/70">Total</span>
        <span className="tabular text-lg font-black text-brand-dark">{formatPrice(order.total_price)}</span>
      </div>
    </Card>
  );
}

function historyStatusHint(status: OrderStatusType): string | null {
  switch (status) {
    case 'rejected':
      return 'Rejected by the canteen — you can place a new order anytime.';
    case 'expired':
      return 'Expired — the 15-minute pickup window was missed.';
    case 'picked':
      return 'Picked up and paid at the counter.';
    default:
      return null;
  }
}

function HistoryList({ orders, activeOrderId }: { orders: Order[]; activeOrderId: number | null }) {
  const past = orders.filter((o) => o.id !== activeOrderId);

  if (past.length === 0) {
    return <EmptyState title="No past orders yet" hint="Your order history will show up here." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {past.map((order) => {
        const hint = historyStatusHint(order.status);
        return (
          <Card key={order.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-ink">Order #{order.id}</p>
                <p className="text-xs text-ink/50">{formatDateTime(order.created_at)}</p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-2 text-sm text-ink/70">
              {order.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
            </p>
            {hint && <p className="mt-1 text-xs text-ink/50">{hint}</p>}
            <p className="tabular mt-2 text-sm font-semibold text-brand-dark">
              {formatPrice(order.total_price)}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

export function OrderStatusPage() {
  const activeOrderQuery = useQuery({ queryKey: ['orders', 'active'], queryFn: getActiveOrder });
  const historyQuery = useQuery({ queryKey: ['orders', 'history'], queryFn: getOrderHistory });

  if (activeOrderQuery.isLoading || historyQuery.isLoading) return <FullPageSpinner />;

  if (activeOrderQuery.isError) {
    const err = activeOrderQuery.error;
    return (
      <EmptyState
        title="Couldn't load your order"
        hint={err instanceof ApiError ? err.message : 'Please try again.'}
      />
    );
  }

  const activeOrder = activeOrderQuery.data ?? null;
  const history = historyQuery.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-2xl font-black tracking-tight text-ink">Order status</h1>
        {activeOrder ? (
          <ActiveOrderView order={activeOrder} />
        ) : (
          <EmptyState
            title="No active order"
            hint="Place an order from the menu and it will show up here."
            action={
              <Link to="/">
                <Button>Browse menu</Button>
              </Link>
            }
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-ink">History</h2>
        <HistoryList orders={history} activeOrderId={activeOrder?.id ?? null} />
      </section>
    </div>
  );
}
