import type { MenuItem } from '../api/types';
import { formatPrice } from '../lib/format';
import { QtyStepper } from './QtyStepper';
import { VegMark } from './VegMark';

interface TrendingRailProps {
  items: MenuItem[];
  /** True once any item has been ordered today; false ⇒ we're showing newest. */
  hasRealCounts: boolean;
  qtyFor: (id: number) => number;
  onQtyChange: (id: number, next: number) => void;
  hasActiveOrder: boolean;
  canOrder: boolean;
}

/**
 * The counter's "what everyone's eating" board, as a horizontal rail of small
 * kraft chits. It opens the menu with the single most characteristic thing in a
 * canteen's day — what's moving right now — and lets a student add straight from
 * it. Falls back to the newest items before the first order of the day lands.
 */
export function TrendingRail({
  items,
  hasRealCounts,
  qtyFor,
  onQtyChange,
  hasActiveOrder,
  canOrder,
}: TrendingRailProps) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="trending-heading" className="animate-rail-in mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2
          id="trending-heading"
          className="font-display text-sm font-bold uppercase tracking-[0.18em] text-ink"
        >
          {hasRealCounts ? 'Ordering right now' : 'Fresh on the menu'}
        </h2>
        <span className="font-display text-[11px] uppercase tracking-wider text-ink/45">
          {hasRealCounts ? "Today's most-ordered" : 'Newest additions'}
        </span>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {items.map((item, i) => {
          const qty = qtyFor(item.id);
          const disableIncrease = !canOrder || !item.orderable;
          const count = item.order_count_today;
          return (
            <article
              key={item.id}
              className="flex w-[172px] shrink-0 snap-start flex-col rounded-2xl border-2 border-dashed border-ink/20 bg-paper p-3 shadow-ticket"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="tabular font-display text-lg font-bold leading-none text-brand-dark">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {hasRealCounts && count > 0 ? (
                  <span className="tabular font-display text-[11px] font-semibold uppercase tracking-wide text-turmeric-deep">
                    {count} today
                  </span>
                ) : (
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-brand">
                    New
                  </span>
                )}
              </div>

              {item.photo_url ? (
                <div className="mb-2 h-20 w-full overflow-hidden rounded-lg border border-edge">
                  <img src={item.photo_url} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ) : (
                <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-edge bg-steel/40 font-display text-2xl font-bold text-ink/25">
                  {item.name.slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="flex min-h-[2.5rem] items-start gap-1.5">
                <VegMark diet={item.diet} size={13} className="mt-[3px]" />
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{item.name}</p>
              </div>

              <span className="tabular font-display mt-1 text-sm font-bold text-brand-dark">
                {formatPrice(item.price)}
              </span>
              {item.rating_count > 0 && (
                <div className="mt-0.5 flex items-center gap-0.5 text-xs font-semibold text-ink/70">
                  <span className="text-turmeric-deep text-[10px]">★</span> {item.avg_rating.toFixed(1)} ({item.rating_count})
                </div>
              )}

              <div className="mt-2.5">
                <QtyStepper
                  value={qty}
                  onChange={(next) => onQtyChange(item.id, next)}
                  disabled={hasActiveOrder}
                  disableIncrease={disableIncrease}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
