import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPrep, markPrepDone } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { PrepItem } from '../../api/types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';

// PrepRow is only ever rendered for items where remaining_qty > 0 (filtered at
// the page level). The "Not needed right now" / canPrep===false branch has been
// removed: it was dead code once the filter was in place, and showing a 0-qty
// row at all conflicts with the product goal of "show only things still to cook".
function PrepRow({ item }: { item: PrepItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selected, setSelected] = useState(() => Math.min(1, item.remaining_qty));

  // remaining_qty can shift under us (another shopkeeper action, an order
  // getting trimmed, an SSE refetch) — keep the selection in range rather
  // than letting it submit a qty that's no longer valid.
  useEffect(() => {
    setSelected((prev) => Math.max(1, Math.min(prev, item.remaining_qty)));
  }, [item.remaining_qty]);

  const doneMutation = useMutation({
    mutationFn: () => markPrepDone(item.menu_item_id, selected),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      setSelected(1);
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not mark item done.', 'error'),
  });

  return (
    <Card className="flex items-center gap-4 p-4">
      {/* The one chalkboard moment in the app — a kitchen prep board reads its
          "left to cook" tally in chalk, not brand-colored digits on paper. */}
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-ink">
        <span className="tabular font-display text-3xl font-bold leading-none text-paper">
          {item.remaining_qty}
        </span>
      </div>
      <div className="flex-1">
        <p className="font-bold text-ink">{item.name}</p>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
          <span>left to cook</span>
          <span className="normal-case text-[10px] opacity-80">पकाना बाकी</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2">
        <QtyStepper value={selected} onChange={setSelected} min={1} max={item.remaining_qty} />
        <Button size="md" fullWidth loading={doneMutation.isPending} onClick={() => doneMutation.mutate()}>
          <div className="flex flex-col items-center leading-tight">
            <span>Done</span>
            <span className="text-[10px] font-medium opacity-80 mt-0.5">पूर्ण</span>
          </div>
        </Button>
      </div>
    </Card>
  );
}

export function ShopPrepPage() {
  const prepQuery = useQuery({ queryKey: ['shop', 'prep'], queryFn: getPrep });

  if (prepQuery.isLoading) return <FullPageSpinner />;

  if (prepQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load the prep list"
        hint={prepQuery.error instanceof ApiError ? prepQuery.error.message : 'Please try again.'}
      />
    );
  }

  // Defensive: only show items that still need cooking. The backend should
  // already filter this, but a stale response or a backend transition period
  // could surface 0-qty items — drop them here before they reach the renderer.
  const items = (prepQuery.data ?? []).filter((item) => item.remaining_qty > 0);

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Prep list</h1>
      <p className="mb-5 text-sm text-ink/60">Aggregate demand across all accepted orders.</p>

      {items.length === 0 ? (
        <EmptyState title="Nothing to prep" hint="All caught up — accepted orders will add items here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <PrepRow key={item.menu_item_id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
