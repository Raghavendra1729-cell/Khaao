import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPrep, markPrepDone } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { PrepItem } from '../../api/types';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';

function PrepRow({ item }: { item: PrepItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const doneMutation = useMutation({
    mutationFn: () => markPrepDone(item.menu_item_id, 1),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] }),
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not mark item done.', 'error'),
  });

  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div>
        <p className="text-lg font-bold text-ink">{item.name}</p>
        <div className="mt-1 flex items-baseline gap-4">
          <span className="tabular text-4xl font-black text-brand-dark">{item.remaining_qty}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">to cook</span>
        </div>
        <p className="tabular mt-1 text-sm text-ink/50">{item.pool_qty} waiting in pool</p>
      </div>
      <button
        type="button"
        disabled={doneMutation.isPending}
        onClick={() => doneMutation.mutate()}
        className="flex h-20 w-20 shrink-0 select-none flex-col items-center justify-center rounded-2xl bg-brand text-white shadow-md transition active:scale-90 active:bg-brand-dark disabled:opacity-50"
      >
        <span className="text-2xl font-black leading-none">+1</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Done</span>
      </button>
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
      <h1 className="mb-1 text-2xl font-black tracking-tight text-ink">Prep list</h1>
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
