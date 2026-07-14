import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-edge bg-paper/50 px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink/60">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
