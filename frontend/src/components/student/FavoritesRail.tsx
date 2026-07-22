import type { MenuItem } from '../../api/types';
import { cloudinaryThumb, formatPrice } from '../../lib/format';
import { QtyStepper } from '../ui/QtyStepper';
import { VegMark } from '../ui/VegMark';

interface FavoritesRailProps {
  items: MenuItem[];
  qtyFor: (id: number) => number;
  onQtyChange: (id: number, next: number) => void;
  hasActiveOrder: boolean;
  canOrder: boolean;
}

/**
 * A student's own pinned dishes (G8) — device-local, quiet, and deliberately
 * distinct from TrendingRail: that rail is everyone's data (rank numbers,
 * "today" counts); this one is personal, so it drops the ranking and uses a
 * solid brand border instead of TrendingRail's dashed ink one, so "yours"
 * never reads as a second "what's trending" board.
 */
export function FavoritesRail({ items, qtyFor, onQtyChange, hasActiveOrder, canOrder }: FavoritesRailProps) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="usuals-heading" className="animate-rail-in mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2
          id="usuals-heading"
          className="font-display text-sm font-bold uppercase tracking-[0.18em] text-ink"
        >
          Your usuals
        </h2>
        <span className="font-display text-[11px] uppercase tracking-wider text-ink/45">
          Saved on this device
        </span>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {items.map((item) => {
          const qty = qtyFor(item.id);
          const disableIncrease = !canOrder || !item.orderable;
          return (
            <article
              key={item.id}
              className="flex w-[172px] shrink-0 snap-start flex-col rounded-2xl border-2 border-brand/30 bg-paper p-3 shadow-ticket"
            >
              {item.photo_url ? (
                <div className="mb-2 h-20 w-full overflow-hidden rounded-lg border border-edge">
                  <img
                    src={cloudinaryThumb(item.photo_url, 350) ?? undefined}
                    alt={item.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
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
