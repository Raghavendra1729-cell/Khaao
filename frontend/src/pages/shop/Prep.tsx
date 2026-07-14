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

function PrepRow({ item }: { item: PrepItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const canPrep = item.remaining_qty > 0;
  const [selected, setSelected] = useState(() => Math.min(1, item.remaining_qty));

  // remaining_qty can shift under us (another shopkeeper action, an order
  // getting trimmed, an SSE refetch) — keep the selection in range rather
  // than letting it submit a qty that's no longer valid.
  useEffect(() => {
    setSelected((prev) => Math.max(1, Math.min(prev, Math.max(item.remaining_qty, 1))));
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
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">left to cook</p>
        <p className="tabular mt-1 text-sm text-ink/50">{item.pool_qty} waiting in pool</p>
      </div>
      {canPrep ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <QtyStepper value={selected} onChange={setSelected} min={1} max={item.remaining_qty} />
          <Button size="md" fullWidth loading={doneMutation.isPending} onClick={() => doneMutation.mutate()}>
            Done
          </Button>
        </div>
      ) : (
        <span className="w-20 shrink-0 text-center text-[11px] font-semibold uppercase leading-tight tracking-wide text-ink/35">
          Not needed right now
        </span>
      )}
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

  const items = prepQuery.data ?? [];

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
