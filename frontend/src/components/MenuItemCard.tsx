import type { MenuItem } from '../api/types';
import { formatPrice } from '../lib/format';
import { QtyStepper } from './QtyStepper';
import { MenuStatusBadge } from './StatusBadge';
import { VegMark } from './VegMark';

function availabilityWindowText(item: MenuItem): string | null {
  if (!item.avail_from && !item.avail_to) return null;
  return `${item.avail_from ?? '00:00'} – ${item.avail_to ?? '23:59'}`;
}

interface MenuItemCardProps {
  item: MenuItem;
  qty: number;
  onQtyChange: (next: number) => void;
  /** Disables the whole stepper (e.g. a student already has an active order). */
  disableStepper?: boolean;
  /** Disables only the "+" (item unorderable, or the canteen isn't open). */
  disableIncrease?: boolean;
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
}: MenuItemCardProps) {
  const availWindow = availabilityWindowText(item);
  const dimmed = !item.orderable;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-edge bg-paper p-3 shadow-card transition ${
        dimmed ? 'opacity-70' : ''
      }`}
    >
      {item.photo_url && (
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-edge">
          <img src={item.photo_url} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <VegMark diet={item.diet} className="mt-0.5" />
          <p className="min-w-0 font-semibold leading-snug text-ink">{item.name}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="tabular font-display text-sm font-bold text-brand-dark">{formatPrice(item.price)}</span>
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
