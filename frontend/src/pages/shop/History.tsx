import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { closeDay, getShopHistory } from '../../api/shop';
import { ApiError } from '../../api/client';
import { formatPrice } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';

/** Today's date as "YYYY-MM-DD" in the browser's local timezone (not UTC —
 * the canteen device is physically where the business day is being tracked,
 * so its local calendar day matches BUSINESS_TIMEZONE far better than UTC
 * does; `toISOString()` would show yesterday's date in the small hours IST). */
function todayLocal(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ShopHistoryPage() {
  const [date, setDate] = useState(todayLocal);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const historyQuery = useQuery({
    queryKey: ['shop', 'history', date],
    queryFn: () => getShopHistory(date),
  });

  const closeDayMutation = useMutation({
    mutationFn: closeDay,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'menu'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
      showToast('Day closed — availability reset.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not close the day.', 'error'),
  });

  function handleCloseDay() {
    if (
      window.confirm(
        'Close the day? Open orders will expire, the done pool clears, and all items go back in stock.',
      )
    ) {
      closeDayMutation.mutate();
    }
  }

  if (historyQuery.isLoading) return <FullPageSpinner />;

  if (historyQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load history"
        hint={historyQuery.error instanceof ApiError ? historyQuery.error.message : 'Please try again.'}
      />
    );
  }

  const { orders, total_paid } = historyQuery.data ?? { orders: [], total_paid: 0 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          Collected today: {formatPrice(total_paid)}
        </h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink focus:border-brand"
        />
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No orders found" hint={`No finished orders for ${date}.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <Card key={order.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display font-bold text-ink">#{order.order_no}</p>
                  <p className="text-sm font-semibold text-ink/70">{order.student_name || 'Student'}</p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>

              <div className="flex flex-col gap-1.5 text-sm text-ink/70">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    {item.photo_url && (
                      <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-edge">
                        <img src={item.photo_url} alt={item.name} className="h-full w-full object-cover" />
                      </div>
                    )}
                    <span>{item.name} ×{item.qty}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-edge pt-3">
                <span className="tabular font-display font-semibold text-brand-dark">{formatPrice(order.total_price)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-stamp/30 bg-stamp-light/50 p-4">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">End of day</h2>
        <p className="text-xs text-ink/60">
          Expires any still-open orders, clears the done-cooking pool, and puts every item back in stock for
          tomorrow. Do this only once the counter is closed and today's cash is reconciled above.
        </p>
        <Button
          variant="danger"
          className="self-start"
          loading={closeDayMutation.isPending}
          onClick={handleCloseDay}
        >
          Close day
        </Button>
      </div>
    </div>
  );
}
