import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getShopHistory } from '../../api/shop';
import { ApiError } from '../../api/client';
import { formatPrice } from '../../lib/format';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderStatusBadge } from '../../components/StatusBadge';

export function ShopHistoryPage() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const historyQuery = useQuery({
    queryKey: ['shop', 'history', date],
    queryFn: () => getShopHistory(date),
  });

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
        <h1 className="text-2xl font-black tracking-tight text-ink">
          Collected today: {formatPrice(total_paid)}
        </h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-sage bg-white px-3 py-2 text-sm text-ink focus:border-brand"
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
                  <p className="font-bold text-ink">#{order.order_no}</p>
                  <p className="text-sm font-semibold text-ink/70">{order.student_name || 'Student'}</p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>
              
              <p className="text-sm text-ink/70">
                {order.items.map(i => `${i.name} ×${i.qty}`).join(', ')}
              </p>
              
              <div className="border-t border-sage pt-3">
                <span className="tabular font-semibold text-brand-dark">{formatPrice(order.total_price)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
