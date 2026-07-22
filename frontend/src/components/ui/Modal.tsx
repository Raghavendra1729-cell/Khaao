import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 'sm' for a compact prompt (pick a quantity), 'md' for an order/form sheet. */
  size?: 'sm' | 'md';
}

const SIZES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A medium overlay dialog. Renders as a bottom sheet on phones and a centered
 * card on wider screens. Tapping the backdrop or pressing Escape closes it, and
 * body scroll is locked while it's open. Toasts (z-[100]) still surface above it
 * so error feedback from an action inside the modal stays visible.
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap Tab inside the dialog — without this, tabbing past the last
      // focusable element lands back on the page underneath, which a
      // keyboard/screen-reader user can't tell is meant to be inert while
      // the dialog is open (F22).
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Move focus into the dialog the moment it opens, and hand it back to
  // whatever had focus beforehand (the button that opened it, typically)
  // once it closes — otherwise a keyboard user's focus silently stays on
  // page content that's now sitting under the backdrop (F22).
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialogRef.current)?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  // Rendered via a portal straight into <body> — this component is used from
  // inside the sticky header, which has backdrop-blur applied. backdrop-filter
  // (like filter and transform) creates a new containing block for descendant
  // `position: fixed` elements, so without a portal this modal's "fixed inset-0"
  // would be sized/positioned relative to the ~56px header instead of the
  // viewport (confirmed live: the overlay rendered as a 390×56px box instead of
  // covering the screen). Escaping to <body> sidesteps that entirely.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`animate-slide-up flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-edge bg-paper shadow-ticket outline-none sm:max-h-[88vh] sm:rounded-2xl ${SIZES[size]}`}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              {title && <div className="font-display text-base font-bold text-ink">{title}</div>}
              {subtitle && <div className="mt-0.5 text-sm text-ink/60">{subtitle}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-ink/50 transition hover:bg-ink/5 hover:text-ink"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-edge bg-paper px-5 py-4 pb-safe">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
