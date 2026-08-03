import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getActiveOrder, getOrderHistory, cancelOrder, submitRatings } from '../../api/orders';
import { getMenu } from '../../api/menu';
import { ApiError } from '../../api/client';
import type { MenuItem, Order, OrderStatus as OrderStatusType, PriceChange } from '../../api/types';
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

function formatElapsed(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h ago` : `${hours}h ${remainder}m ago`;
}

function OrderElapsedTime({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="mb-4 text-center font-display text-xs text-ink/50">
      Placed {formatDateTime(createdAt)} · {formatElapsed(createdAt, now)}
    </p>
  );
}

function takePriceChange(orderId: number): PriceChange | null {
  try {
    const key = `khaao_price_change_${orderId}`;
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as PriceChange).expected !== 'number' ||
      typeof (parsed as PriceChange).charged !== 'number'
    ) {
      return null;
    }
    return parsed as PriceChange;
  } catch {
    return null;
  }
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
  const [priceChange] = useState(() => order.price_changed ?? takePriceChange(order.id));

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
        // STATUS.md § 9.11-X7: this is the student's half of the cash
        // moment (H1 is the shopkeeper's) — the amount is the payload the
        // student is about to hand over at the counter, so it gets the same
        // mono display scale discipline as ReadyBanner's countdown, not
        // body-size type.
        <div className="mb-5 flex w-full flex-col items-center gap-1.5 rounded-2xl bg-turmeric px-4 py-5 text-center text-white shadow-ticket">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/80">Pay at the counter</p>
          <p className="tabular font-display text-4xl font-bold leading-none">
            {formatPrice(order.total_price)}
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

      {order.status !== 'ready' && <OrderElapsedTime createdAt={order.created_at} />}

      {priceChange && (
        <p className="mb-4 rounded-lg border border-turmeric/40 bg-turmeric-pale px-3 py-2 text-center text-sm text-turmeric-deep">
          Your total changed from {formatPrice(priceChange.expected)} to {formatPrice(priceChange.charged)}{' '}
          while you were ordering. You'll pay {formatPrice(priceChange.charged)} at the counter.
        </p>
      )}

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
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = (ratings[item.id] || 0) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRatings((prev) => ({ ...prev, [item.id]: star }))}
                    aria-label={`Rate ${item.name} ${star} out of 5 stars`}
                    aria-pressed={filled}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors ${filled ? 'text-turmeric-deep' : 'text-edge'}`}
                  >
                    {/* STATUS.md § 9.11-X5: this is the interactive rating
                        *control* (a real 44px tap target), not a running-
                        prose rating display — drawn in the app's own stroke
                        language rather than a text ★ glyph. The read-only
                        "★ 4.5 (12)" display on menu cards is the deliberate
                        exception this task carves out and stays text. */}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden
                      className="h-6 w-6"
                      fill={filled ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z" />
                    </svg>
                  </button>
                );
              })}
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
      <span role="status" className="sr-only">
        Loading order status…
      </span>
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">Order status</h1>
        <Card className="animate-soft-pulse p-5" aria-hidden="true">
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
        <div className="flex flex-col gap-3" aria-hidden="true">
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
      // Deliberately no number here — the hold window is HOLD_MINUTES, a
      // real config knob (default 15, but tunable), not a fixed constant;
      // hardcoding "15-minute" would silently start lying the moment a
      // canteen operator tunes it after go-live (STATUS.md § 9.6-U4).
      return 'Expired — the pickup window was missed.';
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
  // menuItems is undefined both while the menu query is still loading and
  // when it has failed (this page deliberately does not gate its own
  // loading state on the menu query — see the OrderStatusPage component
  // below). Either way, reorderIntoCart can't yet tell whether these items
  // are still on today's menu — its own `!menuItems` branch is right to be
  // conservative and report every item as skipped, but rendering that as
  // "None of these items are on today's menu" presents a network/loading
  // state as a confident factual claim, which is exactly the rule this
  // project already enforces everywhere else (R3 / § 9.1.7: never treat a
  // network failure as a data conclusion). Disable the button instead of
  // guessing (STATUS.md § 9.6-U4).
  const menuUnavailable = menuItems === undefined;

  const handleReorder = () => {
    if (menuUnavailable) return;
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
          <Button variant="secondary" disabled={hasActiveOrder || menuUnavailable} onClick={handleReorder}>
            Order this again
          </Button>
          {hasActiveOrder && <p className="mt-1.5 text-xs text-ink/45">Finish your current order first.</p>}
          {!hasActiveOrder && menuUnavailable && (
            <p className="mt-1.5 text-xs text-ink/45">Couldn't check today's menu — try again shortly.</p>
          )}
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
    try {
      localStorage.setItem('khaao_rated_orders', JSON.stringify(next));
    } catch {
      // Private-browsing/quota edge cases: keep the prompt dismissed for this
      // session even when the completed rating cannot be remembered.
    }
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
  // STATUS.md § 9.11-X1: a failed history fetch used to fall through to `[]`,
  // which renders identically to a genuine "never ordered" student — a
  // network failure presented as a confident factual claim (§ 9.1.7 / R25).
  const historyFailed = historyQuery.isError && historyQuery.data === undefined;

  const pastOrders = history.filter((o) => o.id !== activeOrder?.id);
  const mostRecentCompleted = pastOrders.find((o) => o.status === 'completed');
  const showRatingPrompt = mostRecentCompleted && !ratedOrders.includes(mostRecentCompleted.id);

  // A student who has never ordered has neither an active order nor any
  // history — show one welcoming prompt instead of two stacked empty states.
  // Never shown while the history fetch itself has failed — a regular whose
  // history just didn't load must not be told they're a first-time user.
  if (!activeOrder && !hasPastOrders && !historyFailed) {
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
        {historyFailed ? (
          <EmptyState
            title="Couldn't load your past orders."
            hint={historyQuery.error instanceof ApiError ? historyQuery.error.message : 'Please try again.'}
            action={
              <Button variant="secondary" onClick={() => historyQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            {showRatingPrompt && mostRecentCompleted && (
              <RatingPrompt
                order={mostRecentCompleted}
                onDismiss={() => markAsRated(mostRecentCompleted.id)}
              />
            )}
            <HistoryList
              orders={history}
              activeOrderId={activeOrder?.id ?? null}
              menuItems={menuQuery.data}
              hasActiveOrder={activeOrder !== null}
            />
          </>
        )}
      </section>
    </div>
  );
}
