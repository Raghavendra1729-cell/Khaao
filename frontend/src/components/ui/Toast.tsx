import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastVariant = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// STATUS.md § 9.11-X4: a flat 5s was measured against the app's own error
// copy — "2 items removed from your order: … — new total ₹140"
// (StudentRealtime.tsx), "Couldn't mark Paneer Roll out of stock — set them
// manually on the Menu tab" (Orders.tsx) — and found too short to read while
// walking. Errors get longer; success/info stay quick. Never
// persistent-until-dismissed — a permanently stuck toast is its own § 9.1
// problem.
const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  error: 10000,
  success: 5000,
  info: 5000,
};

// A burst of SSE events can otherwise stack toasts past the viewport.
const MAX_VISIBLE_TOASTS = 3;

const VARIANT_STYLES: Record<ToastVariant, string> = {
  error: 'bg-stamp text-white',
  success: 'bg-brand text-white',
  info: 'bg-ink text-white',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'error') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE_TOASTS - 1)), { id, message, variant }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[variant]);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-safe mt-4 sm:items-end sm:pr-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            // role="alert" alone already implies an assertive live region —
            // pairing it with a container-level aria-live="polite" used to
            // risk a double or wrongly-prioritized announcement to screen
            // readers (STATUS.md § 9.11-X4).
            role="alert"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${VARIANT_STYLES[toast.variant]}`}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-80 transition hover:opacity-100"
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
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
