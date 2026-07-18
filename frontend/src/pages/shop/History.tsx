import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getShopHistory } from '../../api/shop';
import { ApiError } from '../../api/client';
import { cloudinaryThumb, formatPrice } from '../../lib/format';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { useLanguage } from '../../context/LanguageContext';

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

/** Display a number-of-items badge: "42" */
function CountBadge({ n }: { n: number }) {
  return (
    <span className="tabular inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-brand-light px-1.5 font-display text-xs font-bold text-brand-dark">
      {n}
    </span>
  );
}

export function ShopHistoryPage() {
  const { language } = useLanguage();
  const [date, setDate] = useState(todayLocal);
  const [showOrders, setShowOrders] = useState(false);

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

  const { orders, total_paid, insights } = historyQuery.data ?? {
    orders: [],
    total_paid: 0,
    insights: { order_count: 0, item_counts: [], customers: [] },
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header row: total + date picker */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {formatPrice(total_paid)}
          </h1>
          <p className="text-sm text-ink/50">collected on {date}</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-edge bg-paper px-3 py-2.5 text-sm text-ink shadow-sm focus:border-brand focus:outline-none"
        />
      </div>

      {/* ── Insights panel ─────────────────────────────────────────── */}
      {insights.order_count > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Total orders */}
          <Card className="flex flex-col gap-1 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Orders</p>
            <p className="font-display text-3xl font-bold text-ink">{insights.order_count}</p>
            <p className="text-sm text-ink/50">completed today</p>
          </Card>

          {/* Top items */}
          {insights.item_counts.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Top items</p>
              <div className="flex flex-col gap-2">
                {insights.item_counts.slice(0, 5).map((ic) => (
                  <div key={ic.name} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{ic.name}</span>
                    <CountBadge n={ic.qty} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top customers */}
          {insights.customers.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Regulars</p>
              <div className="flex flex-col gap-2">
                {insights.customers.slice(0, 5).map((c) => (
                  <div key={c.name} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">{c.name || 'Student'}</span>
                    <span className="tabular shrink-0 text-xs text-ink/50">
                      {c.order_count} order{c.order_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Order list ─────────────────────────────────────────────── */}
      {orders.length === 0 ? (
        <EmptyState title="No orders found" hint={`No finished orders for ${date}.`} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Toggle button — collapsed by default */}
          <button
            type="button"
            onClick={() => setShowOrders((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-xl border border-edge bg-paper px-4 py-3 text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-brand-light/30 focus:outline-none"
          >
            <span>
              {language === 'hi'
                ? showOrders
                  ? 'ऑर्डर लॉग छुपाएं'
                  : `हर ऑर्डर देखें (${orders.length})`
                : showOrders
                  ? 'Hide order log'
                  : `Show every order (${orders.length})`}
            </span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 shrink-0 text-ink/50 transition-transform duration-200 ${
                showOrders ? 'rotate-180' : ''
              }`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {/* Expanded order grid */}
          {showOrders && (
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
                            <img
                              src={cloudinaryThumb(item.photo_url, 56) ?? undefined}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        )}
                        <span>
                          {item.name} ×{item.qty}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-edge pt-3">
                    <span className="tabular font-display font-semibold text-brand-dark">
                      {formatPrice(order.total_price)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
