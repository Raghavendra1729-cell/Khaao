interface QtyStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Blocks both buttons entirely (e.g. no active order allowed at all). */
  disabled?: boolean;
  /** Blocks only the "+" button — lets an already-nonzero qty still be
   * reduced/removed even when the item can no longer be increased (e.g. it
   * went out of stock after being added to the cart). */
  disableIncrease?: boolean;
  /** Names what this stepper counts (e.g. the item name), read into the
   * live-region announcement as "<label> quantity: <value>". This control
   * can appear many times on one page (menu rows, both rails, checkout,
   * prep board, handover modal) — a local, per-instance accessible name
   * avoids the ambiguity a single global announcer would have to resolve
   * (STATUS.md § 9.9-Y9: prefer this over `lib/liveAnnouncer.ts`). Omit for
   * a generic "Quantity" label. */
  label?: string;
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 20,
  disabled = false,
  disableIncrease = false,
  label,
}: QtyStepperProps) {
  const atCeiling = !disabled && !disableIncrease && value >= max;
  const accessibleValueLabel = `${label ? `${label} quantity` : 'Quantity'}: ${value}`;

  return (
    <div className="inline-flex select-none items-center overflow-hidden rounded-xl border border-edge">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 items-center justify-center text-brand transition active:bg-brand-light disabled:opacity-30"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 12h12" />
        </svg>
      </button>
      {/* aria-live carries the announcement; the label names what's being
          counted since one page can hold many of these steppers at once. No
          visible text changes here — this is screen-reader-only context, the
          same "explain, don't decorate" call StatusBadge's title/aria-label
          pairing makes elsewhere. */}
      <span
        aria-live="polite"
        aria-label={accessibleValueLabel}
        className="tabular flex h-11 w-10 items-center justify-center border-x border-edge text-base font-semibold"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={atCeiling ? `Increase quantity — maximum ${max} reached` : 'Increase quantity'}
        disabled={disabled || disableIncrease || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-11 w-11 items-center justify-center text-brand transition active:bg-brand-light disabled:opacity-30"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 6v12M6 12h12" />
        </svg>
      </button>
    </div>
  );
}
