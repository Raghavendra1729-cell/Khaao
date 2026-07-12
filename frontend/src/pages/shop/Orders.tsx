import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptOrder, closeOrder, getShopOrders, rejectOrder } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { Order, OrderItem } from '../../api/types';
import { formatPrice, formatTime } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderTicket } from '../../components/OrderTicket';
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
            #{order.id} · {formatTime(order.created_at)}
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
  return `${item.allocated_qty}/${item.qty}`;
}

function ActiveOrderCard({ order }: { order: Order }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink">{order.student_name || 'Student'}</p>
          <p className="text-xs text-ink/50">#{order.id}</p>
        </div>
        <span className="tabular text-sm font-semibold text-brand-dark">{formatPrice(order.total_price)}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {order.items
          .filter((i) => i.status !== 'rejected')
          .map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span className="text-ink/80">
                {item.name} ×{item.qty}
              </span>
              <span className="tabular font-semibold text-ink/60">{itemProgress(item)}</span>
            </div>
          ))}
      </div>
    </Card>
  );
}

function ReadyOrderCard({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const closeMutation = useMutation({
    mutationFn: () => closeOrder(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      showToast(`Order #${order.id} closed.`, 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not close order.', 'error'),
  });

  return (
    <Card className="flex flex-col items-center gap-4 p-5">
      <OrderTicket id={order.id} />
      <p className="font-semibold text-ink">{order.student_name || 'Student'}</p>
      <Button fullWidth loading={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
        Close (handed over + paid)
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

  const { incoming, active, ready } = ordersQuery.data ?? { incoming: [], active: [], ready: [] };

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      <Column
        title="Incoming"
        count={incoming.length}
        emptyTitle="No incoming orders"
        emptyHint="New orders will appear here for you to accept or reject."
      >
        {incoming.map((order) => (
          <IncomingOrderCard key={order.id} order={order} />
        ))}
      </Column>

      <Column
        title="Active"
        count={active.length}
        emptyTitle="Nothing cooking right now"
        emptyHint="Accepted orders being prepared will show up here."
      >
        {active.map((order) => (
          <ActiveOrderCard key={order.id} order={order} />
        ))}
      </Column>

      <Column
        title="Ready"
        count={ready.length}
        emptyTitle="No orders ready for pickup"
        emptyHint="Fully-prepared orders will show up here."
      >
        {ready.map((order) => (
          <ReadyOrderCard key={order.id} order={order} />
        ))}
      </Column>
    </div>
  );
}
