import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptOrder, handoverItem, markPaid, getShopOrders, rejectOrder, removeOrderItem } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { Order, OrderItem } from '../../api/types';
import { formatPrice, formatTime } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';

function IncomingOrderCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const pendingItems = order.items.filter((i) => i.status === 'pending');
  const lockedItems = order.items.filter((i) => i.status !== 'pending' && i.status !== 'rejected');
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(pendingItems.map((i) => [i.id, true])),
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });

  const acceptMutation = useMutation({
    mutationFn: () => {
      const rejectedItemIds = pendingItems.filter((i) => !checked[i.id]).map((i) => i.id);
      return acceptOrder(order.id, rejectedItemIds);
    },
    onSuccess: invalidate,
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not accept order.', 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectOrder(order.id),
    onSuccess: invalidate,
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not reject order.', 'error'),
  });

  const busy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink">{order.student_name || 'Student'}</p>
          <p className="text-xs text-ink/50">
            #{order.order_no} · {formatTime(order.created_at)}
          </p>
        </div>
        <span className="tabular text-sm font-semibold text-brand-dark">{formatPrice(order.total_price)}</span>
      </div>

      {lockedItems.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5 rounded-lg bg-black/5 p-2.5">
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

      <div className="mb-4 flex flex-col gap-2">
        {pendingItems.map((item) => (
          <label
            key={item.id}
            className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-sage px-3 py-2"
          >
            <input
              type="checkbox"
              checked={checked[item.id] ?? true}
              onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
              className="h-5 w-5 accent-brand"
            />
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
          loading={rejectMutation.isPending}
          onClick={() => rejectMutation.mutate()}
        >
          Reject
        </Button>
        <Button
          className="flex-1"
          disabled={busy}
          loading={acceptMutation.isPending}
          onClick={() => acceptMutation.mutate()}
        >
          Accept
        </Button>
      </div>
    </Card>
  );
}

function itemProgress(item: OrderItem): string {
  return `ready ${item.allocated_qty}/${item.qty} · picked ${item.handed_qty ?? 0}`;
}

function CookingOrderCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const handleHandover = async (itemId: number, qty: number) => {
    try {
      await handoverItem(order.id, itemId, qty);
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not hand over item.', 'error');
    }
  };

  const handleRemove = async (itemId: number, name: string) => {
    if (!window.confirm(`Remove "${name}" from this order? Any prepared units go back to the pool.`)) return;
    try {
      await removeOrderItem(order.id, itemId);
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      showToast('Item removed.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove item.', 'error');
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink">{order.student_name || 'Student'}</p>
          <p className="text-xs text-ink/50">#{order.order_no}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-sage pt-3">
        {order.items
          .filter((i) => i.status !== 'rejected')
          .map((item) => {
            const readyToGive = item.allocated_qty - (item.handed_qty ?? 0);
            return (
              <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-ink">
                    {item.name} ×{item.qty}
                  </span>
                  <span className="text-[11px] text-ink/50">{itemProgress(item)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(item.handed_qty ?? 0) === 0 && (
                    <button
                      type="button"
                      onClick={() => handleRemove(item.id, item.name)}
                      className="text-[11px] font-semibold text-red-600/80 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                  {readyToGive > 1 && (
                    <Button size="md" onClick={() => handleHandover(item.id, readyToGive)}>
                      Give all {readyToGive}
                    </Button>
                  )}
                  <Button
                    size="md"
                    variant="secondary"
                    disabled={readyToGive <= 0}
                    onClick={() => handleHandover(item.id, 1)}
                  >
                    Give 1
                  </Button>
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

function AwaitingPaymentCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const markPaidMutation = useMutation({
    mutationFn: () => markPaid(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
      showToast(`Order #${order.order_no} paid.`, 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not collect payment.', 'error'),
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xl font-black text-ink">#{order.order_no}</span>
          <p className="font-semibold text-ink">{order.student_name || 'Student'}</p>
        </div>
      </div>
      
      <div className="text-sm text-ink/70">
        {order.items.filter(i => i.status !== 'rejected').map((item) => (
          <div key={item.id} className="flex justify-between">
            <span>{item.name} ×{item.qty}</span>
          </div>
        ))}
      </div>

      <Button size="lg" fullWidth loading={markPaidMutation.isPending} onClick={() => markPaidMutation.mutate()}>
        Paid {formatPrice(order.total_price)}
      </Button>
    </Card>
  );
}

function Column({
  title,
  count,
  emptyTitle,
  emptyHint,
  children,
}: {
  title: string;
  count: number;
  emptyTitle: string;
  emptyHint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        {title}
        <span className="tabular rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-ink/60">
          {count}
        </span>
      </h2>
      {count === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function ShopOrdersPage() {
  const ordersQuery = useQuery({ queryKey: ['shop', 'orders'], queryFn: getShopOrders });

  if (ordersQuery.isLoading) return <FullPageSpinner />;

  if (ordersQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load orders"
        hint={ordersQuery.error instanceof ApiError ? ordersQuery.error.message : 'Please try again.'}
      />
    );
  }

  const { incoming, in_progress, awaiting_payment } = ordersQuery.data ?? { incoming: [], in_progress: [], awaiting_payment: [] };

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      <Column
        title="New"
        count={incoming.length}
        emptyTitle="No incoming orders"
        emptyHint="New orders will appear here for you to accept or reject."
      >
        {incoming.map((order) => (
          <IncomingOrderCard key={order.id} order={order} />
        ))}
      </Column>

      <Column
        title="Cooking"
        count={in_progress.length}
        emptyTitle="Nothing cooking right now"
        emptyHint="Accepted orders being prepared will show up here."
      >
        {in_progress.map((order) => (
          <CookingOrderCard key={order.id} order={order} />
        ))}
      </Column>

      <Column
        title="Collect payment"
        count={awaiting_payment.length}
        emptyTitle="No payments pending"
        emptyHint="Orders that are fully handed over will show up here for payment."
      >
        {awaiting_payment.map((order) => (
          <AwaitingPaymentCard key={order.id} order={order} />
        ))}
      </Column>
    </div>
  );
}
