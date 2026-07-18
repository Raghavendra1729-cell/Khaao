import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptOrder,
  getShopOrders,
  rejectOrder,
  setMenuItemStock,
} from '../../api/shop';
import { ApiError } from '../../api/client';
import type { Order } from '../../api/types';
import { cloudinaryThumb, formatPrice, formatTime } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { OrderModal } from '../../components/OrderModal';
import { clearShopNotification } from '../../components/shopNotifications';
import { useLanguage } from '../../context/LanguageContext';

// ─── New orders subpage ───────────────────────────────────────────────────────

/**
 * Reject dialog: shows a checklist of this order's items so the shopkeeper
 * can flag which ones are unavailable before confirming. Checked = unavailable.
 */
function RejectDialog({
  order,
  onCancel,
  onConfirm,
  busy,
}: {
  order: Order;
  onCancel: () => void;
  onConfirm: (unavailableItemIds: number[]) => void;
  busy: boolean;
}) {
  const { language } = useLanguage();
  const items = order.items.filter((i) => i.status !== 'rejected');
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.menu_item_id, false])),
  );

  const unavailableMenuItemIds = items
    .filter((i) => checked[i.menu_item_id])
    .map((i) => i.menu_item_id);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-t-2xl bg-paper p-5 shadow-2xl sm:rounded-2xl">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Reject order #{order.order_no}</h2>
        <p className="mb-4 text-sm text-ink/60">
          Tick any items that are unavailable — they'll be marked out of stock automatically.
        </p>
        <div className="mb-5 flex flex-col gap-2">
          {items.map((item) => (
            <label
              key={item.menu_item_id}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-edge px-3 py-2"
            >
              <input
                type="checkbox"
                checked={checked[item.menu_item_id] ?? false}
                onChange={(e) =>
                  setChecked((prev) => ({ ...prev, [item.menu_item_id]: e.target.checked }))
                }
                className="h-5 w-5 accent-stamp"
              />
              {item.photo_url && (
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-edge">
                  <img
                    src={cloudinaryThumb(item.photo_url, 64) ?? undefined}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <span className="flex-1 text-sm font-medium text-ink">
                {item.name} ×{item.qty}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy}
            loading={busy}
            onClick={() => onConfirm(unavailableMenuItemIds)}
          >
            <span>{language === 'hi' ? 'अस्वीकार करें' : 'Reject order'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function IncomingOrderCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const pendingItems = order.items.filter((i) => i.status === 'pending');
  const lockedItems = order.items.filter((i) => i.status !== 'pending' && i.status !== 'rejected');
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(pendingItems.map((i) => [i.id, true])),
  );
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const rejectedItems = pendingItems.filter((i) => !checked[i.id]);
      const rejectedItemIds = rejectedItems.map((i) => i.id);
      await Promise.allSettled(
        rejectedItems.map((i) => setMenuItemStock(i.menu_item_id, true)),
      );
      return acceptOrder(order.id, rejectedItemIds);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not accept order.', 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (unavailableMenuItemIds: number[]) => {
      // Mark each flagged item out of stock before rejecting.
      await Promise.allSettled(
        unavailableMenuItemIds.map((menuItemId) => setMenuItemStock(menuItemId, true)),
      );
      return rejectOrder(order.id);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      setShowRejectDialog(false);
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not reject order.', 'error'),
  });

  const busy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <>
      <Card className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-ink">{order.student_name || 'Student'}</p>
            <p className="tabular font-display text-xs text-ink/50">
              #{order.order_no} · {formatTime(order.created_at)}
            </p>
          </div>
          <span className="tabular font-display text-sm font-semibold text-brand-dark">
            {formatPrice(order.total_price)}
          </span>
        </div>

        {lockedItems.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5 rounded-lg bg-ink/5 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">Already accepted</p>
            {lockedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm text-ink/50">
                <span>
                  {item.name} ×{item.qty}
                </span>
                <span className="tabular">
                  {item.allocated_qty}/{item.qty}
                </span>
              </div>
            ))}
          </div>
        )}

        {pendingItems.length > 1 && (
          <p className="mb-1.5 text-xs text-ink/50">Uncheck anything you're out of, then Accept the rest.</p>
        )}
        <div className="mb-4 flex flex-col gap-2">
          {pendingItems.map((item) => (
            <label
              key={item.id}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-edge px-3 py-2"
            >
              <input
                type="checkbox"
                checked={checked[item.id] ?? true}
                onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                className="h-5 w-5 accent-brand"
              />
              {item.photo_url && (
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-edge">
                  <img
                    src={cloudinaryThumb(item.photo_url, 72) ?? undefined}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <span className="flex-1 text-sm font-medium text-ink">
                {item.name} ×{item.qty}
              </span>
              <span className="tabular text-sm text-ink/50">{formatPrice(item.price_each * item.qty)}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={() => setShowRejectDialog(true)}
          >
            <span>{language === 'hi' ? 'अस्वीकार करें' : 'Reject'}</span>
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            loading={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
          >
            <span>{language === 'hi' ? 'स्वीकारें' : 'Accept'}</span>
          </Button>
        </div>
      </Card>

      {showRejectDialog && (
        <RejectDialog
          order={order}
          onCancel={() => setShowRejectDialog(false)}
          onConfirm={(ids) => rejectMutation.mutate(ids)}
          busy={rejectMutation.isPending}
        />
      )}
    </>
  );
}

// ─── In-progress subpage ──────────────────────────────────────────────────────

/** True if every non-rejected item has been fully handed over (awaiting_payment logic). */
function isFullyReady(order: Order): boolean {
  const active = order.items.filter((i) => i.status !== 'rejected');
  return active.length > 0 && active.every((i) => i.handed_qty >= i.qty);
}

/** Compact per-item status dots shown on the collapsed In-progress card. */
function ItemStatusDots({ order }: { order: Order }) {
  const items = order.items.filter((i) => i.status !== 'rejected');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => {
        const handedOver = item.handed_qty >= item.qty;
        const readyToGive = item.allocated_qty >= item.qty && !handedOver;
        return (
          <span
            key={item.id}
            className="flex items-center gap-1.5 text-xs text-ink/60"
            aria-label={`${item.name} — ${
              handedOver ? 'handed over' : readyToGive ? 'ready to give' : 'cooking'
            }`}
          >
            {handedOver ? (
              <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full bg-brand text-[7px] font-bold text-white">
                ✓
              </span>
            ) : (
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  readyToGive ? 'bg-turmeric' : 'border border-ink/30'
                }`}
              />
            )}
            <span className={handedOver ? 'text-ink/40 line-through' : ''}>
              {item.name}
              {item.qty > 1 ? ` ×${item.qty}` : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function InProgressOrderCard({
  order,
  onOpenModal,
}: {
  order: Order;
  onOpenModal: (order: Order) => void;
}) {
  const activeItems = order.items.filter((i) => i.status !== 'rejected');
  const ready = isFullyReady(order) || order.status === 'awaiting_payment';

  return (
    <button
      type="button"
      onClick={() => onOpenModal(order)}
      className={`w-full rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
        ready
          ? 'border-brand/40 bg-brand-light/50 shadow-sm'
          : 'border-edge bg-paper hover:border-brand/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {ready && (
              <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Ready
              </span>
            )}
            <p className="truncate font-bold text-ink">{order.student_name || 'Student'}</p>
          </div>
          <p className="tabular mt-0.5 font-display text-xs text-ink/50">
            #{order.order_no} · {activeItems.length} item{activeItems.length !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="tabular shrink-0 font-display text-sm font-semibold text-brand-dark">
          {formatPrice(order.total_price)}
        </span>
      </div>

      <ItemStatusDots order={order} />

      <p className="mt-2 text-xs font-medium text-brand-dark/70">Tap to manage →</p>
    </button>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

type Subpage = 'new' | 'inprogress';

export function ShopOrdersPage() {
  const { language } = useLanguage();
  const ordersQuery = useQuery({ queryKey: ['shop', 'orders'], queryFn: getShopOrders });
  const [subpage, setSubpage] = useState<Subpage>('new');
  const [modalOrder, setModalOrder] = useState<Order | null>(null);

  // When the shopkeeper lands on this page, clear the notification dot.
  useEffect(() => {
    clearShopNotification();
  }, []);

  if (ordersQuery.isLoading) return <FullPageSpinner />;

  if (ordersQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load orders"
        hint={ordersQuery.error instanceof ApiError ? ordersQuery.error.message : 'Please try again.'}
      />
    );
  }

  const { incoming, in_progress, awaiting_payment } = ordersQuery.data ?? {
    incoming: [],
    in_progress: [],
    awaiting_payment: [],
  };

  // Combine in_progress and awaiting_payment into one "In progress" list.
  // awaiting_payment orders are fully ready — sort them to the top.
  const allInProgress: Order[] = [
    ...awaiting_payment,
    ...in_progress.filter((o) => isFullyReady(o)),
    ...in_progress.filter((o) => !isFullyReady(o)),
  ];

  const inProgressCount = allInProgress.length;
  const newCount = incoming.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Segmented control */}
      <div className="flex rounded-xl border border-edge bg-paper p-1">
        <button
          type="button"
          id="tab-new-orders"
          onClick={() => setSubpage('new')}
          className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
            subpage === 'new'
              ? 'bg-brand text-white shadow-sm'
              : 'text-ink/60 hover:text-ink'
          }`}
        >
          <span>{language === 'hi' ? 'नए ऑर्डर' : 'New orders'}</span>
          {newCount > 0 && (
            <span
              className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                subpage === 'new' ? 'bg-white/25 text-white' : 'bg-turmeric text-white'
              }`}
            >
              {newCount}
            </span>
          )}
        </button>
        <button
          type="button"
          id="tab-in-progress"
          onClick={() => setSubpage('inprogress')}
          className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
            subpage === 'inprogress'
              ? 'bg-brand text-white shadow-sm'
              : 'text-ink/60 hover:text-ink'
          }`}
        >
          <span>{language === 'hi' ? 'प्रगति में' : 'In progress'}</span>
          {inProgressCount > 0 && (
            <span
              className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                subpage === 'inprogress' ? 'bg-white/25 text-white' : 'bg-ink/15 text-ink/70'
              }`}
            >
              {inProgressCount}
            </span>
          )}
        </button>
      </div>

      {/* Subpage content */}
      {subpage === 'new' && (
        <div className="flex flex-col gap-3">
          {newCount === 0 ? (
            <EmptyState
              title="No new orders"
              hint="New orders will appear here for you to accept or reject."
            />
          ) : (
            incoming.map((order) => <IncomingOrderCard key={order.id} order={order} />)
          )}
        </div>
      )}

      {subpage === 'inprogress' && (
        <div className="flex flex-col gap-3">
          {inProgressCount === 0 ? (
            <EmptyState
              title="Nothing in progress"
              hint="Accepted orders appear here. Tap an order to manage handover and payment."
            />
          ) : (
            allInProgress.map((order) => (
              <InProgressOrderCard
                key={order.id}
                order={order}
                onOpenModal={setModalOrder}
              />
            ))
          )}
        </div>
      )}

      {/* Order modal — rendered outside the subpage so it survives subpage switches */}
      {modalOrder && (
        <OrderModal
          order={
            // Keep the modal's order data live: prefer the freshest copy from
            // the query (which re-fetches on every SSE orders_update) so the
            // modal reflects handover / payment state in real time.
            allInProgress.find((o) => o.id === modalOrder.id) ?? modalOrder
          }
          onClose={() => setModalOrder(null)}
        />
      )}
    </div>
  );
}
