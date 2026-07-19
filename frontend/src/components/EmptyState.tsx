import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
  /** Optional quiet ink-toned glyph rendered above the title, ~48px. Every
   * existing call site omits this and renders identically to before. */
  icon?: ReactNode;
}

export function EmptyState({ title, hint, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge bg-paper/50 px-6 py-10 text-center">
      {icon && <div className="mb-1 h-12 w-12 text-ink/25">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink/60">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
