import { useEffect, type ReactNode } from 'react';

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

/**
 * A medium overlay dialog. Renders as a bottom sheet on phones and a centered
 * card on wider screens. Tapping the backdrop or pressing Escape closes it, and
 * body scroll is locked while it's open. Toasts (z-[100]) still surface above it
 * so error feedback from an action inside the modal stays visible.
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`animate-slide-up flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-edge bg-paper shadow-ticket sm:max-h-[88vh] sm:rounded-2xl ${SIZES[size]}`}
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
    </div>
  );
}
