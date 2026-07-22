import type { Diet } from '../../api/types';
import { VegMark } from '../ui/VegMark';

export type DietFilterValue = 'all' | Diet;

interface DietFilterProps {
  value: DietFilterValue;
  onChange: (next: DietFilterValue) => void;
}

const OPTIONS: { key: DietFilterValue; label: string; diet?: Diet }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'veg', label: 'Veg', diet: 'veg' },
  { key: 'non_veg', label: 'Non-veg', diet: 'non_veg' },
];

/**
 * A three-way veg / non-veg filter shown as a segmented chit strip. The veg
 * marks do the labelling so the control reads the same way the menu does.
 */
export function DietFilter({ value, onChange }: DietFilterProps) {
  return (
    <div
      role="group"
      aria-label="Filter by diet"
      className="inline-flex items-center gap-1 rounded-xl border border-edge bg-paper p-1"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            // Visual pill stays compact; the invisible ::before expands the
            // actual hit target to >=44px without growing the chip on screen
            // (§ 9.1.2). before:content-[''] + a negative inset is the
            // standard "expanded hit area" technique.
            className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wide transition before:absolute before:-inset-2.5 before:content-[''] ${
              active ? 'bg-brand text-white shadow-sm' : 'text-ink/60 hover:text-ink'
            }`}
          >
            {opt.diet && <VegMark diet={opt.diet} size={13} className={active ? 'bg-white' : ''} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
