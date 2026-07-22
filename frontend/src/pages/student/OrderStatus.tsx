import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getActiveOrder, getOrderHistory, cancelOrder, submitRatings } from '../../api/orders';
import { getMenu } from '../../api/menu';
import { ApiError } from '../../api/client';
import type { MenuItem, Order, OrderStatus as OrderStatusType } from '../../api/types';
import {
  cloudinaryThumb,
  formatCountdown,
  formatDateTime,
  formatPrice,
  secondsUntil,
} from '../../lib/format';
import { loadStoredCart, reorderIntoCart, saveStoredCart } from '../../lib/cart';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { LedgerLineIcon } from '../../components/ui/EmptyStateIcons';
import { OrderTicket } from '../../components/student/OrderTicket';
import { StatusStamps } from '../../components/student/StatusStamps';
import { OrderItemStatusBadge, OrderStatusBadge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';

function ReadyBanner({ order }: { order: Order }) {
  const [remaining, setRemaining] = useState(() => secondsUntil(order.expires_at));

  useEffect(() => {
    setRemaining(secondsUntil(order.expires_at));
    const id = window.setInterval(() => setRemaining(secondsUntil(order.expires_at)), 1000);
    return () => window.clearInterval(id);
  }, [order.expires_at]);

  const expiringSoon = remaining <= 60;

  return (
    // Two layers so the mount-in pop (one-shot, transform+opacity) and the
    // ambient glow (infinite, box-shadow) can run as separate `animate-*`
    // utilities without fighting over the same `animation` property on one
    // element — the outer div carries the glow "halo", the inner card pops.
    <div className="mb-5 w-full animate-ready-glow rounded-2xl">
      <div className="flex w-full animate-ready-pop flex-col items-center gap-1 rounded-2xl bg-stamp px-4 py-5 text-center text-white shadow-ticket">
        <p className="text-lg font-bold tracking-tight">Ready — pick up before the timer, pay at counter</p>
        <p className={`tabular font-display text-3xl font-bold ${expiringSoon ? 'animate-soft-pulse' : ''}`}>
          {remaining > 0 ? formatCountdown(remaining) : "Time's up"}
        </p>
        <p className="text-xs text-white/80">Show your token number at the counter.</p>
      </div>
    </div>
  );
}

function ActiveOrderView({ order, onCancel }: { order: Order; onCancel: () => void }) {
  const droppedItems = order.items.filter((i) => i.status === 'rejected');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // The ticket should pop exactly once, on the transition INTO "ready" — not
  // on every re-render while already ready, and not on first mount if the
  // order happens to *arrive* already ready (e.g. a page refresh while
  // ready). `prevStatusRef` starts at `null` ("unknown prior state") and a
  // `null` prior status never counts as a transition, mirroring the
  // prevStatusRef idiom in components/student/StudentRealtime.tsx (which likewise
  // treats an unseeded prior status as "don't notify").
  const prevStatusRef = useRef<OrderStatusType | null>(null);
  const [ticketPopping, setTicketPopping] = useState(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = order.status;
    if (prevStatus !== null && prevStatus !== 'ready' && order.status === 'ready') {
      setTicketPopping(true);
      const id = window.setTimeout(() => setTicketPopping(false), 350);
      return () => window.clearTimeout(id);
    }
  }, [order.status]);

  return (
    <Card className="p-5">
      {order.status === 'ready' && <ReadyBanner order={order} />}
      {order.status === 'awaiting_payment' && (
        <div className="mb-5 flex w-full flex-col items-center gap-1 rounded-2xl bg-turmeric px-4 py-5 text-center text-white shadow-ticket">
          <p className="text-xl font-bold tracking-tight">
            Pay {formatPrice(order.total_price)} at the counter
          </p>
          <p className="text-sm font-semibold text-white/90">All items are ready.</p>
        </div>
      )}
      {droppedItems.length > 0 && (
        <div className="mb-5 flex w-full flex-col items-center gap-1 rounded-2xl bg-stamp px-4 py-5 text-center text-white shadow-ticket">
          <p className="text-lg font-bold tracking-tight">Some items were dropped from your order</p>
          <p className="text-sm font-semibold text-white/90">
            {droppedItems.map((i) => `${i.name} ×${i.qty}`).join(', ')}
          </p>
          <p className="text-xs text-white/80">Current total: {formatPrice(order.total_price)}</p>
        </div>
      )}

      <div
        className={`mb-6 flex justify-center ${ticketPopping ? 'animate-tick-pop' : ''}`}
        // Staggered a beat behind the ready banner's own animate-ready-pop
        // (no delay) so the two reads as one choreographed moment rather
        // than two animations firing at once.
        style={ticketPopping ? { animationDelay: '120ms' } : undefined}
      >
        <OrderTicket id={order.order_no} size="lg" />
      </div>

      <div className="mb-6">
        <StatusStamps status={order.status} />
      </div>

      {order.status === 'partially_ready' && (
        <p className="mb-4 rounded-lg bg-turmeric-pale px-3 py-2 text-center text-sm font-medium text-turmeric-deep">
          Some items are ready — the rest are still cooking.
        </p>
      )}

      <div className="divide-y divide-edge">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-2.5">
            {item.photo_url && (
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-edge">
                <img
                  src={cloudinaryThumb(item.photo_url, 96) ?? undefined}
                  alt={item.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{item.name}</p>
              <p className="tabular text-xs text-ink/50">
                {item.allocated_qty}/{item.qty} ready · {item.handed_qty ?? 0} picked up
              </p>
            </div>
            <OrderItemStatusBadge status={item.status} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
        <span className="font-semibold text-ink/70">Total</span>
        <span className="tabular font-display text-lg font-bold text-brand-dark">
          {formatPrice(order.total_price)}
        </span>
      </div>

      {order.status === 'submitted' && (
        <div className="mt-5 border-t border-edge pt-5">
          <Button variant="secondary" fullWidth onClick={() => setConfirmingCancel(true)}>
            Cancel order
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this order?"
        body={`Cancel order #${order.order_no}? This can't be undone.`}
        confirmLabel="Cancel order"
        onCancel={() => setConfirmingCancel(false)}
        onConfirm={() => {
          setConfirmingCancel(false);
          onCancel();
        }}
      />
    </Card>
  );
}

function RatingPrompt({ order, onDismiss }: { order: Order; onDismiss: () => void }) {
  const { showToast } = useToast();
  const rateableItems = order.items.filter((i) => i.status !== 'rejected');
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (rateableItems.length === 0) return null;

  const handleSubmit = async () => {
    const payload = Object.entries(ratings).map(([id, stars]) => ({
      order_item_id: parseInt(id, 10),
      stars,
    }));
    if (payload.length === 0) return;

    setIsSubmitting(true);
    try {
      await submitRatings(order.id, payload);
      showToast('Thanks for your feedback!', 'success');
      onDismiss();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not submit ratings', 'error');
      setIsSubmitting(false);
    }
  };

  return (
    // A ring rather than a border override — Card's own `border-edge` is a
    // same-CSS-property class already baked into its base template, so a
    // border-color override here would silently lose the cascade tie
    // (Tailwind resolves same-specificity utility collisions by source order
    // in the generated stylesheet, and `border-edge` is emitted after
    // `border-brand-dark`). A ring uses box-shadow, a different property
    // entirely, so it can't collide with Card's own border.
    <Card className="mb-4 ring-2 ring-brand-dark bg-paper p-4">
      <h3 className="mb-3 font-display text-lg font-bold text-ink">Rate your recent order</h3>
      <div className="flex flex-col gap-4">
        {rateableItems.map((item) => (
          <div key={item.id} className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">{item.name}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatings((prev) => ({ ...prev, [item.id]: star }))}
                  aria-label={`Rate ${item.name} ${star} out of 5 stars`}
                  aria-pressed={(ratings[item.id] || 0) >= star}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center text-2xl transition-colors ${(ratings[item.id] || 0) >= star ? 'text-turmeric-deep' : 'text-edge'}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-edge pt-4">
        <button
          type="button"
          onClick={onDismiss}
          className="-my-2.5 flex min-h-[44px] items-center text-sm font-medium text-ink/60 underline underline-offset-2"
        >
          Skip
        </button>
        <Button onClick={handleSubmit} disabled={isSubmitting || Object.keys(ratings).length === 0}>
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </Button>
      </div>
    </Card>
  );
}

// Paper-toned placeholder shaped like the real content (a ticket-sized block
// + a couple of history-row blocks) so the page doesn't jump/reflow once
// data lands — replaces a generic full-page spinner (F15).
function OrderStatusSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">Order status</h1>
        <Card className="animate-soft-pulse p-5">
          <div className="mb-6 flex justify-center">
            <div className="h-32 w-56 rounded-2xl border-2 border-dashed border-edge bg-paper" />
          </div>
          <div className="divide-y divide-edge">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <div className="h-12 w-12 shrink-0 rounded-md bg-edge/60" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 h-3.5 w-2/3 rounded bg-edge/60" />
                  <div className="h-3 w-1/3 rounded bg-edge/40" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
            <div className="h-4 w-12 rounded bg-edge/40" />
            <div className="h-5 w-16 rounded bg-edge/60" />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-ink">History</h2>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="animate-soft-pulse p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="mb-1.5 h-4 w-24 rounded bg-edge/60" />
                  <div className="h-3 w-32 rounded bg-edge/40" />
                </div>
                <div className="h-5 w-16 shrink-0 rounded-full bg-edge/60" />
              </div>
              <div className="mt-3 h-3 w-2/5 rounded bg-edge/40" />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function historyStatusHint(status: OrderStatusType): string | null {
  switch (status) {
    case 'rejected':
      return 'Rejected by the canteen — you can place a new order anytime.';
    case 'expired':
      return 'Expired — the 15-minute pickup window was missed.';
    case 'cancelled':
      return 'You cancelled this order.';
    case 'completed':
      return 'Picked up and paid at the counter.';
    default:
      return null;
  }
}

// G3: builds the reorder toast copy honestly — full / partial / none, never
// a generic "done" that papers over items that didn't make it in.
function reorderToastMessage(addedCount: number, skippedNames: string[]): string {
  if (addedCount === 0) {
    return "None of these items are on today's menu.";
  }
  if (skippedNames.length === 0) {
    return `${addedCount} item${addedCount === 1 ? '' : 's'} added to your cart.`;
  }
  const total = addedCount + skippedNames.length;
  const skippedText =
    skippedNames.length === 1
      ? `${skippedNames[0]} isn't on today's menu.`
      : `${skippedNames.join(', ')} aren't on today's menu.`;
  return `${addedCount} of ${total} added — ${skippedText}`;
}

function HistoryCard({
  order,
  menuItems,
  hasActiveOrder,
}: {
  order: Order;
  menuItems: MenuItem[] | undefined;
  hasActiveOrder: boolean;
}) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const hint = historyStatusHint(order.status);
  const canReorder = order.status === 'completed';

  const handleReorder = () => {
    const { cart, addedCount, skippedNames } = reorderIntoCart(loadStoredCart(), order.items, menuItems);
    showToast(reorderToastMessage(addedCount, skippedNames), addedCount === 0 ? 'error' : 'success');
    if (addedCount === 0) return;
    saveStoredCart(cart);
    navigate('/');
  };

  return (
    <Card className="animate-status-in p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink">Token #{order.order_no}</p>
          <p className="text-xs text-ink/50">{formatDateTime(order.created_at)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>
      <div className="mt-2 flex flex-col gap-1.5 text-sm text-ink/70">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            {item.photo_url && (
              <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-edge">
                <img
                  src={cloudinaryThumb(item.photo_url, 56) ?? undefined}
                  alt={item.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
            <span>
              {item.name} ×{item.qty}
            </span>
          </div>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-ink/50">{hint}</p>}
      <p className="tabular font-display mt-2 text-sm font-semibold text-brand-dark">
        {formatPrice(order.total_price)}
      </p>
      {canReorder && (
        <div className="mt-3 border-t border-edge pt-3">
          <Button variant="secondary" disabled={hasActiveOrder} onClick={handleReorder}>
            Order this again
          </Button>
          {hasActiveOrder && <p className="mt-1.5 text-xs text-ink/45">Finish your current order first.</p>}
        </div>
      )}
    </Card>
  );
}

function HistoryList({
  orders,
  activeOrderId,
  menuItems,
  hasActiveOrder,
}: {
  orders: Order[];
  activeOrderId: number | null;
  menuItems: MenuItem[] | undefined;
  hasActiveOrder: boolean;
}) {
  const past = orders.filter((o) => o.id !== activeOrderId);

  if (past.length === 0) {
    return (
      <EmptyState
        icon={<LedgerLineIcon />}
        title="No past orders yet"
        hint="Your order history will show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {past.map((order) => (
        <HistoryCard key={order.id} order={order} menuItems={menuItems} hasActiveOrder={hasActiveOrder} />
      ))}
    </div>
  );
}

export function OrderStatusPage() {
  const { showToast } = useToast();
  const activeOrderQuery = useQuery({ queryKey: ['orders', 'active'], queryFn: getActiveOrder });
  const historyQuery = useQuery({ queryKey: ['orders', 'history'], queryFn: getOrderHistory });
  // G3 "Order this again" needs today's live menu to know what's still
  // orderable — same query key as the Menu page, so this shares its cache
  // instead of firing a second independent fetch.
  const menuQuery = useQuery({ queryKey: ['menu'], queryFn: getMenu });

  const handleCancel = async () => {
    const activeOrder = activeOrderQuery.data;
    if (!activeOrder) return;
    try {
      await cancelOrder(activeOrder.id);
      activeOrderQuery.refetch();
      historyQuery.refetch();
      showToast('Order cancelled.', 'success');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not cancel order', 'error');
    }
  };

  const [ratedOrders, setRatedOrders] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('khaao_rated_orders') || '[]');
    } catch {
      return [];
    }
  });

  const markAsRated = (orderId: number) => {
    // Only the most recent completed order is ever checked against this
    // list (see mostRecentCompleted below), so it never needs more than a
    // handful of ids — cap it rather than let it grow forever.
    const next = [...ratedOrders, orderId].slice(-50);
    setRatedOrders(next);
    localStorage.setItem('khaao_rated_orders', JSON.stringify(next));
  };

  if (activeOrderQuery.isLoading || historyQuery.isLoading) return <OrderStatusSkeleton />;

  // isError also fires after a failed *background* refetch, while data
  // still holds the last good response — only replace the screen with an
  // error state if there's nothing cached to show instead (R25).
  if (activeOrderQuery.isError && activeOrderQuery.data === undefined) {
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
  const hasPastOrders = history.some((o) => o.id !== activeOrder?.id);

  const pastOrders = history.filter((o) => o.id !== activeOrder?.id);
  const mostRecentCompleted = pastOrders.find((o) => o.status === 'completed');
  const showRatingPrompt = mostRecentCompleted && !ratedOrders.includes(mostRecentCompleted.id);

  // A student who has never ordered has neither an active order nor any
  // history — show one welcoming prompt instead of two stacked empty states.
  if (!activeOrder && !hasPastOrders) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">Order status</h1>
        <EmptyState
          title="Place your first order"
          hint="Browse today's menu, build a cart, and track it live once it's in."
          action={
            <Link to="/">
              <Button>Browse menu</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">Order status</h1>
        {activeOrder ? (
          <ActiveOrderView order={activeOrder} onCancel={handleCancel} />
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
        {showRatingPrompt && mostRecentCompleted && (
          <RatingPrompt order={mostRecentCompleted} onDismiss={() => markAsRated(mostRecentCompleted.id)} />
        )}
        <HistoryList
          orders={history}
          activeOrderId={activeOrder?.id ?? null}
          menuItems={menuQuery.data}
          hasActiveOrder={activeOrder !== null}
        />
      </section>
    </div>
  );
}
