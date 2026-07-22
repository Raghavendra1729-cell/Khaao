import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
}

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold ' +
  'transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ' +
  'disabled:active:scale-100';

const SIZES: Record<Size, string> = {
  md: 'min-h-[44px] px-5 py-2.5 text-[15px]',
  lg: 'min-h-[56px] px-6 py-3.5 text-lg',
};

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:bg-brand-dark',
  secondary: 'border border-brand/30 bg-paper text-brand hover:bg-brand-light',
  danger: 'bg-stamp text-white shadow-sm hover:bg-stamp-dark',
  // A visible (if quiet) border matters here: hover reveals a plain-text
  // button's affordance on desktop, but touch devices have no hover — without
  // a border this reads as inert text, not a tappable control.
  ghost: 'border border-edge bg-transparent text-ink hover:bg-ink/5 active:bg-ink/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth, loading, className = '', children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading && (
        <Spinner size={18} className={variant === 'secondary' || variant === 'ghost' ? '' : 'text-white'} />
      )}
      {children}
    </button>
  );
});
