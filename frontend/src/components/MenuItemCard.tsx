import type { MenuItem } from '../api/types';
import { cloudinaryThumb, formatPrice } from '../lib/format';
import { QtyStepper } from './QtyStepper';
import { MenuStatusBadge } from './StatusBadge';
import { VegMark } from './VegMark';

function availabilityWindowText(item: MenuItem): string | null {
  if (!item.avail_from && !item.avail_to) return null;
  return `${item.avail_from ?? '00:00'} – ${item.avail_to ?? '23:59'}`;
}

/**
 * G8's pin toggle — an ink-line bookmark (quiet, matching the EmptyStateIcons
 * hand-drawn stroke language) overlaid on the photo's corner rather than
 * squeezed into the row as a fourth flex sibling, since the row is already
 * tight at 375px (photo + name + stepper). The invisible ::before expands the
 * real hit target to ≥44px without growing the visual mark (§ 9.1.2).
 */
function FavoriteToggle({
  active,
  itemName,
  onToggle,
}: {
  active: boolean;
  itemName: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? `Remove ${itemName} from your usuals` : `Add ${itemName} to your usuals`}
      className={`absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition before:absolute before:-inset-2.5 before:content-[''] ${
        active ? 'border-brand bg-brand text-white' : 'border-edge bg-paper/95 text-ink/35 hover:text-ink/60'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V20l-6-4-6 4V4.5z" />
      </svg>
    </button>
  );
}

interface MenuItemCardProps {
  item: MenuItem;
  qty: number;
  onQtyChange: (next: number) => void;
  /** Disables the whole stepper (e.g. a student already has an active order). */
  disableStepper?: boolean;
  /** Disables only the "+" (item unorderable, or the canteen isn't open). */
  disableIncrease?: boolean;
  /** G8: whether this item is pinned to "Your usuals". Omit to hide the
   * toggle entirely (e.g. a read-only card). */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

/**
 * One menu item, printed as its own kraft chit. The veg/non-veg mark leads the
 * name (as it does on any Indian menu board); the price is set in the mono
 * "data" voice; a status tag only appears when the item is anything other than
 * plainly available, so the list stays quiet.
 */
export function MenuItemCard({
  item,
  qty,
  onQtyChange,
  disableStepper = false,
  disableIncrease = false,
  isFavorite,
  onToggleFavorite,
}: MenuItemCardProps) {
  const availWindow = availabilityWindowText(item);
  const dimmed = !item.orderable;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-edge bg-paper p-3 shadow-card transition ${
        dimmed ? 'opacity-70' : ''
      }`}
    >
      <div className="relative h-16 w-16 shrink-0">
        {item.photo_url ? (
          <div className="h-16 w-16 overflow-hidden rounded-lg border border-edge">
            <img
              src={cloudinaryThumb(item.photo_url, 128) ?? undefined}
              alt={item.name}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          // Same kraft-initial placeholder as TrendingRail's no-photo fallback,
          // sized to this card's h-16 w-16 slot, so rows keep their rhythm
          // instead of losing the image column entirely.
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-edge bg-steel/40 font-display text-xl font-bold text-ink/25">
            {item.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        {onToggleFavorite && (
          <FavoriteToggle active={Boolean(isFavorite)} itemName={item.name} onToggle={onToggleFavorite} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <VegMark diet={item.diet} className="mt-0.5" />
          <p className="min-w-0 font-semibold leading-snug text-ink">{item.name}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="tabular font-display text-sm font-bold text-brand-dark">
            {formatPrice(item.price)}
          </span>
          {item.rating_count > 0 && (
            <span className="flex items-center gap-0.5 text-xs font-semibold text-ink/70">
              <span className="text-turmeric-deep text-[10px]">★</span> {item.avg_rating.toFixed(1)} (
              {item.rating_count})
            </span>
          )}
          {item.status !== 'available' && <MenuStatusBadge status={item.status} />}
        </div>
        {availWindow && <p className="mt-0.5 text-xs text-ink/45">Available {availWindow}</p>}
      </div>

      <QtyStepper
        value={qty}
        onChange={onQtyChange}
        disabled={disableStepper}
        disableIncrease={disableIncrease}
      />
    </div>
  );
}
