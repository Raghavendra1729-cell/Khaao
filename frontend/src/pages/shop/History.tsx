import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getShopHistory } from '../../api/shop';
import { ApiError } from '../../api/client';
import { cloudinaryThumb, formatPrice, formatShortDate } from '../../lib/format';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { OrderStatusBadge } from '../../components/ui/StatusBadge';
import { useLanguage } from '../../context/LanguageContext';
import type { Order } from '../../api/types';

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

/** Shifts a "YYYY-MM-DD" string by `deltaDays`, entirely in local time (G5:
 * same reasoning as todayLocal() above — never parse/format through UTC, or
 * the stepper drifts a day near local midnight). */
function shiftDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Chevron for the G5 date stepper — reuses the down-chevron path already in
 * this file (the order-log toggle) rotated to point left/right, rather than
 * inventing a second glyph style in the same component. */
function DayStepChevron({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-4 w-4 shrink-0 ${direction === 'prev' ? 'rotate-90' : '-rotate-90'}`}
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
  );
}

/** Display a number-of-items badge: "42" */
function CountBadge({ n }: { n: number }) {
  return (
    <span className="tabular inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-brand-light px-1.5 font-display text-xs font-bold text-brand-dark">
      {n}
    </span>
  );
}

// ─── Y5: day-shape + revenue-per-item, derived client-side from `orders` ─────
// (`getShopHistory` already fetches everything needed — no backend change.)

const HALF_HOURS_PER_DAY = 48;

/** Which half-hour bucket (0-47, local time) an ISO timestamp falls into. */
function halfHourBucketIndex(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
}

interface DayShapeBucket {
  index: number;
  hour: number;
  half: 0 | 1;
  count: number; // orders created in this half-hour
  revenue: number; // paise paid in this half-hour
}

/** Buckets the day's orders by half-hour: order count from `created_at`
 * (when the rush arrived), revenue from `paid_at` (when the money actually
 * landed — not always the same moment, e.g. pay-after-handover). Always
 * returns all 48 buckets; callers slice down to the active range. */
function buildDayShape(orders: Order[]): DayShapeBucket[] {
  const buckets: DayShapeBucket[] = Array.from({ length: HALF_HOURS_PER_DAY }, (_, i) => ({
    index: i,
    hour: Math.floor(i / 2),
    half: (i % 2) as 0 | 1,
    count: 0,
    revenue: 0,
  }));
  for (const order of orders) {
    if (order.created_at) {
      buckets[halfHourBucketIndex(order.created_at)].count += 1;
    }
    if (order.paid_at) {
      buckets[halfHourBucketIndex(order.paid_at)].revenue += order.total_price;
    }
  }
  return buckets;
}

/** Short, deterministic hour label a canteen actually thinks in — "1p",
 * "12p", "9a" — instead of raw 24-hour clock ticks or an ICU-dependent
 * locale format (kept in the same spirit as lib/format.ts's formatShortDate,
 * which avoids toLocaleDateString for the same determinism reason). */
function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? 'a' : 'p'}`;
}

interface ItemRevenue {
  name: string;
  revenue: number; // paise
}

/** Revenue per item (qty × price_each, summed across every order), sorted
 * highest-earning first. Deliberately independent of the backend's
 * `insights.item_counts` (qty only) — the item that sells the most units is
 * often not the item that earns the most, and that's the point of this. */
function revenueByItem(orders: Order[]): ItemRevenue[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.qty * item.price_each);
    }
  }
  return Array.from(totals.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

const CHIT_PX = 4; // each stacked chit's height, px
const TRACK_HEIGHT_PX = 72; // the column's vertical scale envelope
const CHIT_THRESHOLD = Math.floor(TRACK_HEIGHT_PX / CHIT_PX); // degrade past this count

/** One half-hour column: stacked kraft chits, one per order, up to
 * CHIT_THRESHOLD — at canteen volumes (tens of orders/day) a shopkeeper can
 * literally count them. Past that, a solid bar stands in rather than
 * rendering 200 rectangles; the count above the column stays the same
 * either way, so nothing readable is lost. */
function DayShapeColumn({ bucket, maxCount }: { bucket: DayShapeBucket; maxCount: number }) {
  const degraded = bucket.count > CHIT_THRESHOLD;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" style={{ width: 18 }}>
      {/* The count is the accessible content — never aria-hidden. */}
      <span className="tabular font-display text-[10px] font-bold leading-none text-paper">
        {bucket.count > 0 ? bucket.count : ' '}
      </span>
      <div
        className="flex w-full flex-col-reverse items-stretch"
        style={{ height: TRACK_HEIGHT_PX }}
        aria-hidden="true"
      >
        {degraded ? (
          <div
            className="w-full rounded-[1px] bg-paper"
            style={{ height: `${Math.max((bucket.count / maxCount) * 100, 8)}%` }}
          />
        ) : (
          Array.from({ length: bucket.count }, (_, i) => (
            <div key={i} className="h-1 w-full shrink-0 rounded-[1px] border-t border-ink/50 bg-paper" />
          ))
        )}
      </div>
      <span className="text-[9px] leading-none text-paper/40">
        {bucket.half === 0 ? formatHourLabel(bucket.hour) : ''}
      </span>
    </div>
  );
}

/** The day's shape: when the rush hit, how long it lasted. Extends the "Top
 * items" bar's idiom (G6) into a full strip, drawn like the kitchen's own
 * chalkboard tally — ink background, paper mono digits, same language as
 * Prep.tsx's PrepSummaryStrip/PrepRow tally block — rather than a generic
 * chart. A raw div, not the shared `Card` (which hardcodes `bg-paper`): a
 * caller className relying on the cascade to override a hardcoded base
 * class can silently lose that tie (§ 9.1.10), so this follows
 * PrepSummaryStrip's own precedent of a plain `bg-ink` div instead. */
function DayShapeCard({ orders, language }: { orders: Order[]; language: 'en' | 'hi' }) {
  const buckets = buildDayShape(orders);
  const activeIndices = buckets.reduce<number[]>((acc, b, i) => {
    if (b.count > 0) acc.push(i);
    return acc;
  }, []);
  if (activeIndices.length === 0) return null; // nothing to draw (defensive; the page already gates on order_count > 0)

  const startIdx = Math.max(0, Math.min(...activeIndices) - 1);
  const endIdx = Math.min(HALF_HOURS_PER_DAY - 1, Math.max(...activeIndices) + 1);
  const visible = buckets.slice(startIdx, endIdx + 1);
  const maxCount = Math.max(1, ...visible.map((b) => b.count));
  const busiest = visible.reduce((best, b) => (b.count > best.count ? b : best), visible[0]);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-ink p-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-paper/50">
          {language === 'hi' ? 'दिन का उतार-चढ़ाव' : 'Day shape'}
        </p>
        <p className="text-sm text-paper/80">
          {language === 'hi'
            ? `सबसे व्यस्त ${formatHourLabel(busiest.hour)} बजे — ${busiest.count} ऑर्डर, ${formatPrice(busiest.revenue)}`
            : `Busiest around ${formatHourLabel(busiest.hour)} — ${busiest.count} order${busiest.count === 1 ? '' : 's'}, ${formatPrice(busiest.revenue)}`}
        </p>
      </div>
      {/* § 9.1.5: wide content scrolls in its own container, never the page. */}
      <div className="overflow-x-auto">
        <div className="flex items-end gap-1.5 pb-1">
          {visible.map((b) => (
            <DayShapeColumn key={b.index} bucket={b} maxCount={maxCount} />
          ))}
        </div>
      </div>
    </div>
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
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDate((d) => shiftDate(d, -1))}
              aria-label={language === 'hi' ? 'पिछला दिन' : 'Previous day'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-edge bg-paper text-ink/60 shadow-sm transition hover:bg-brand-light/30 active:bg-brand-light/50"
            >
              <DayStepChevron direction="prev" />
            </button>
            <input
              type="date"
              value={date}
              max={todayLocal()}
              // Clearing the native picker (browsers allow this — an "x"
              // affordance or Backspace) fires onChange with "" — falling
              // back to today rather than storing it avoids two compounding
              // breaks: shiftDate("", ±1) parses "" into "NaN-NaN-NaN" (no
              // guard there either), and a "NaN-NaN-NaN" queryKey is a fetch
              // this page has never cached, so the backend's 400 trips the
              // isError-with-no-cached-data early return — which replaces
              // this entire section (date input included) with an error
              // screen with no in-page way back to a valid date.
              onChange={(e) => setDate(e.target.value || todayLocal())}
              className="min-h-[44px] rounded-xl border border-edge bg-paper px-3 py-2.5 text-base text-ink shadow-sm focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setDate((d) => shiftDate(d, 1))}
              disabled={isToday}
              aria-label={language === 'hi' ? 'अगला दिन' : 'Next day'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-edge bg-paper text-ink/60 shadow-sm transition hover:bg-brand-light/30 active:bg-brand-light/50 disabled:opacity-40 disabled:hover:bg-paper"
            >
              <DayStepChevron direction="next" />
            </button>
          </div>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(todayLocal())}
              className="relative rounded-full border border-brand/30 bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark transition before:absolute before:-inset-2.5 before:content-[''] hover:bg-brand-light/70"
            >
              {language === 'hi' ? 'आज पर जाएं' : 'Jump to today'}
            </button>
          )}
        </div>
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
              <div className="flex flex-col gap-2.5">
                {(() => {
                  const topItems = insights.item_counts.slice(0, 5);
                  // Y13: an all-zero day (every returned qty is 0) made this
                  // Math.max(...) 0, so ic.qty / maxQty was 0/0 — NaN — and
                  // the resulting `width: NaN%` was silently dropped by the
                  // browser. Floor it at 1 so the division always resolves.
                  const maxQty = Math.max(1, ...topItems.map((ic) => ic.qty));
                  return topItems.map((ic) => (
                    <div key={ic.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink">{ic.name}</span>
                        <CountBadge n={ic.qty} />
                      </div>
                      {/* G6: a quiet proportional ledger bar — numbers above
                          stay the accessible content, this is decoration. */}
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-brand-light"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${Math.max((ic.qty / maxQty) * 100, 6)}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
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

          {/* Y5: revenue per item — derived client-side from orders[].items,
              deliberately a different ranking than the qty-only "Top items"
              card above (the item that sells most is often not the item
              that earns most). Same G6 proportional-bar idiom, turmeric-toned
              (the kitchen color) to read as a distinct metric, not a re-skin. */}
          {(() => {
            const topEarners = revenueByItem(orders).slice(0, 5);
            if (topEarners.length === 0) return null;
            const maxRevenue = Math.max(1, ...topEarners.map((ir) => ir.revenue));
            return (
              <Card className="flex flex-col gap-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                  {language === 'hi' ? 'सबसे ज़्यादा कमाई' : 'Top earners'}
                </p>
                <div className="flex flex-col gap-2.5">
                  {topEarners.map((ir) => (
                    <div key={ir.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink">{ir.name}</span>
                        <span className="tabular shrink-0 font-display text-xs font-bold text-turmeric-deep">
                          {formatPrice(ir.revenue)}
                        </span>
                      </div>
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-turmeric-pale"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-turmeric"
                          style={{ width: `${Math.max((ir.revenue / maxRevenue) * 100, 6)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </div>
      )}

      {/* Y5: the day's shape — full width, its own row (not the stat-card
          grid above), since it needs horizontal room to scroll and reads as
          the kitchen's own chalkboard rather than another paper card. */}
      {insights.order_count > 0 && <DayShapeCard orders={orders} language={language} />}

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
