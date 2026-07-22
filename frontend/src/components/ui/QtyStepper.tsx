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
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 20,
  disabled = false,
  disableIncrease = false,
}: QtyStepperProps) {
  return (
    <div className="inline-flex select-none items-center overflow-hidden rounded-xl border border-edge">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 items-center justify-center text-xl font-bold text-brand transition active:bg-brand-light disabled:opacity-30"
      >
        −
      </button>
      <span className="tabular flex h-11 w-10 items-center justify-center border-x border-edge text-base font-semibold">
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled || disableIncrease || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-11 w-11 items-center justify-center text-xl font-bold text-brand transition active:bg-brand-light disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
