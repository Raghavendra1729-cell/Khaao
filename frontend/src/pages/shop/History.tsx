import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getShopHistory } from '../../api/shop';
import { ApiError } from '../../api/client';
import { cloudinaryThumb, formatPrice, formatShortDate } from '../../lib/format';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
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

/** Paper-toned skeleton shaped like the real page (F15) — header block, the
 * three insight cards, and the order-log toggle bar — so the page doesn't
 * reflow when data lands and reads as "loading", not "broken", on the
 * hostile campus network (§ 9.1.7). */
function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-32 animate-soft-pulse rounded-md bg-edge" />
          <div className="h-4 w-36 animate-soft-pulse rounded bg-edge/70" />
        </div>
        <div className="h-11 w-40 animate-soft-pulse rounded-xl border border-edge bg-paper" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex flex-col gap-3 p-4">
            <div className="h-3 w-16 animate-soft-pulse rounded bg-edge" />
            <div className="h-8 w-12 animate-soft-pulse rounded bg-edge/70" />
            <div className="h-3 w-24 animate-soft-pulse rounded bg-edge/50" />
          </Card>
        ))}
      </div>

      <div className="h-12 w-full animate-soft-pulse rounded-xl border border-edge bg-paper" />
    </div>
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

  if (historyQuery.isLoading) return <HistorySkeleton />;

  // isError also fires after a failed *background* refetch, while data
  // still holds the last good response — only replace the screen with an
  // error state if there's nothing cached to show instead (R25).
  if (historyQuery.isError && historyQuery.data === undefined) {
    return (
      <EmptyState
        title={language === 'hi' ? 'इतिहास लोड नहीं हो सका' : "Couldn't load history"}
        hint={
          historyQuery.error instanceof ApiError
            ? historyQuery.error.message
            : language === 'hi'
              ? 'कृपया फिर से कोशिश करें।'
              : 'Please try again.'
        }
      />
    );
  }

  const { orders, total_paid, insights } = historyQuery.data ?? {
    orders: [],
    total_paid: 0,
    insights: { order_count: 0, item_counts: [], customers: [] },
  };

  const isToday = date === todayLocal();
  const humanDate = formatShortDate(date);

  return (
    <div className="flex flex-col gap-6">
      {/* Header row: total + date picker */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {formatPrice(total_paid)}
          </h1>
          <p className="text-sm text-ink/50">
            {language === 'hi'
              ? isToday
                ? 'आज एकत्र किया गया'
                : `${humanDate} को एकत्र किया गया`
              : isToday
                ? 'collected today'
                : `collected on ${humanDate}`}
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-[44px] rounded-xl border border-edge bg-paper px-3 py-2.5 text-base text-ink shadow-sm focus:border-brand focus:outline-none"
        />
      </div>

      {/* ── Insights panel ─────────────────────────────────────────── */}
      {insights.order_count > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Total orders */}
          <Card className="flex flex-col gap-1 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
              {language === 'hi' ? 'ऑर्डर' : 'Orders'}
            </p>
            <p className="font-display text-3xl font-bold text-ink">{insights.order_count}</p>
            <p className="text-sm text-ink/50">
              {language === 'hi'
                ? isToday
                  ? 'आज पूरे हुए'
                  : `${humanDate} को पूरे हुए`
                : isToday
                  ? 'completed today'
                  : `completed on ${humanDate}`}
            </p>
          </Card>

          {/* Top items */}
          {insights.item_counts.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                {language === 'hi' ? 'टॉप आइटम' : 'Top items'}
              </p>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                {language === 'hi' ? 'नियमित ग्राहक' : 'Regulars'}
              </p>
              <div className="flex flex-col gap-2">
                {insights.customers.slice(0, 5).map((c) => (
                  <div key={c.name} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-ink">
                      {c.name || (language === 'hi' ? 'छात्र' : 'Student')}
                    </span>
                    <span className="tabular shrink-0 text-xs text-ink/50">
                      {language === 'hi'
                        ? `${c.order_count} ऑर्डर`
                        : `${c.order_count} order${c.order_count !== 1 ? 's' : ''}`}
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
        <EmptyState
          title={language === 'hi' ? 'कोई ऑर्डर नहीं मिला' : 'No orders found'}
          hint={
            language === 'hi'
              ? `${humanDate} के लिए कोई पूर्ण ऑर्डर नहीं।`
              : `No finished orders for ${humanDate}.`
          }
        />
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
