import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPrep, markPrepDone } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { PrepItem } from '../../api/types';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { useLanguage } from '../../context/LanguageContext';

// PrepRow is only ever rendered for items where remaining_qty > 0 (filtered at
// the page level). The "Not needed right now" / canPrep===false branch has been
// removed: it was dead code once the filter was in place, and showing a 0-qty
// row at all conflicts with the product goal of "show only things still to cook".
function PrepRow({ item }: { item: PrepItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const [selected, setSelected] = useState(() => Math.min(1, item.remaining_qty));

  // remaining_qty can shift under us (another shopkeeper action, an order
  // getting trimmed, an SSE refetch) — keep the selection in range rather
  // than letting it submit a qty that's no longer valid.
  useEffect(() => {
    setSelected((prev) => Math.max(1, Math.min(prev, item.remaining_qty)));
  }, [item.remaining_qty]);

  // F19: tick the tally digit when a successful Done lands and the count
  // actually changes. expectTickRef is armed in the mutation's onSuccess and
  // consumed the next time remaining_qty differs from what we last saw — that
  // way an unrelated SSE-driven change to remaining_qty doesn't also "tick".
  const prevRemainingRef = useRef(item.remaining_qty);
  const expectTickRef = useRef(false);
  const [ticked, setTicked] = useState(false);

  useEffect(() => {
    if (expectTickRef.current && item.remaining_qty !== prevRemainingRef.current) {
      setTicked(true);
      expectTickRef.current = false;
    }
    prevRemainingRef.current = item.remaining_qty;
  }, [item.remaining_qty]);

  const doneMutation = useMutation({
    mutationFn: () => markPrepDone(item.menu_item_id, selected),
    onSuccess: () => {
      expectTickRef.current = true;
      queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
      setSelected(1);
    },
    onError: (err) =>
      showToast(
        err instanceof ApiError
          ? err.message
          : language === 'hi'
            ? 'आइटम पूर्ण के रूप में चिह्नित नहीं हो सका।'
            : 'Could not mark item done.',
        'error',
      ),
  });

  return (
    <Card className="flex items-center gap-4 p-4">
      {/* The one chalkboard moment in the app — a kitchen prep board reads its
          "left to cook" tally in chalk, not brand-colored digits on paper. */}
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-ink">
        <span
          onAnimationEnd={() => setTicked(false)}
          className={`tabular font-display text-3xl font-bold leading-none text-paper ${
            ticked ? 'animate-tick-pop' : ''
          }`}
        >
          {item.remaining_qty}
        </span>
      </div>
      <div className="flex-1">
        <p className="font-bold text-ink">{item.name}</p>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
          <span className={language === 'hi' ? 'normal-case' : ''}>
            {language === 'hi' ? 'पकाना बाकी' : 'left to cook'}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2">
        <QtyStepper value={selected} onChange={setSelected} min={1} max={item.remaining_qty} />
        <Button size="md" fullWidth loading={doneMutation.isPending} onClick={() => doneMutation.mutate()}>
          <span>{language === 'hi' ? 'पूर्ण' : 'Done'}</span>
        </Button>
      </div>
    </Card>
  );
}

/** Chalkboard-style summary strip above the grid — same tally-block language
 * (ink bg, paper mono digits) as PrepRow's own tally, extended into a header
 * line rather than a new visual idea (F19). */
function PrepSummaryStrip({ items, language }: { items: PrepItem[]; language: 'en' | 'hi' }) {
  const totalUnits = items.reduce((sum, item) => sum + item.remaining_qty, 0);
  const itemCount = items.length;
  return (
    <div className="mb-4 flex items-center gap-4 rounded-xl bg-ink px-4 py-3">
      <span className="tabular font-display text-3xl font-bold leading-none text-paper">{totalUnits}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-paper/70">
        {language === 'hi'
          ? `${itemCount} आइटम में कुल ${totalUnits} यूनिट`
          : `unit${totalUnits === 1 ? '' : 's'} across ${itemCount} item${itemCount === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}

// ─── Loading skeleton (F15) ───────────────────────────────────────────────────

function PrepRowSkeleton() {
  return (
    <Card className="flex animate-soft-pulse items-center gap-4 p-4">
      <div className="h-16 w-16 shrink-0 rounded-md bg-ink/10" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-4 w-24 rounded bg-ink/10" />
        <div className="h-3 w-16 rounded bg-ink/10" />
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="h-9 w-24 rounded-lg bg-ink/10" />
        <div className="h-9 w-24 rounded-lg bg-ink/10" />
      </div>
    </Card>
  );
}

function PrepSkeleton() {
  return (
    <div>
      <div className="mb-1 h-7 w-32 animate-soft-pulse rounded bg-ink/10" />
      <div className="mb-5 h-4 w-56 animate-soft-pulse rounded bg-ink/10" />
      <div className="mb-4 h-[60px] animate-soft-pulse rounded-xl bg-ink/10" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PrepRowSkeleton />
        <PrepRowSkeleton />
        <PrepRowSkeleton />
        <PrepRowSkeleton />
      </div>
    </div>
  );
}

export function ShopPrepPage() {
  const { language } = useLanguage();
  const prepQuery = useQuery({ queryKey: ['shop', 'prep'], queryFn: getPrep });

  if (prepQuery.isLoading) return <PrepSkeleton />;

  // isError also fires after a failed *background* refetch, while data
  // still holds the last good response — only replace the screen with an
  // error state if there's nothing cached to show instead (R25).
  if (prepQuery.isError && prepQuery.data === undefined) {
    return (
      <EmptyState
        title={language === 'hi' ? 'तैयारी सूची लोड नहीं हो सकी' : "Couldn't load the prep list"}
        hint={
          prepQuery.error instanceof ApiError
            ? prepQuery.error.message
            : language === 'hi'
              ? 'कृपया पुनः प्रयास करें।'
              : 'Please try again.'
        }
      />
    );
  }

  // Defensive: only show items that still need cooking. The backend should
  // already filter this, but a stale response or a backend transition period
  // could surface 0-qty items — drop them here before they reach the renderer.
  const items = (prepQuery.data ?? []).filter((item) => item.remaining_qty > 0);

  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">
        {language === 'hi' ? 'तैयारी सूची' : 'Prep list'}
      </h1>
      <p className="mb-5 text-sm text-ink/60">
        {language === 'hi' ? 'सभी स्वीकृत ऑर्डर की कुल मांग।' : 'Aggregate demand across all accepted orders.'}
      </p>

      {items.length === 0 ? (
        <EmptyState
          title={language === 'hi' ? 'पकाने के लिए कुछ नहीं' : 'Nothing to prep'}
          hint={
            language === 'hi'
              ? 'सब पूरा हो गया — स्वीकृत ऑर्डर यहां आइटम जोड़ेंगे।'
              : 'All caught up — accepted orders will add items here.'
          }
        />
      ) : (
        <>
          <PrepSummaryStrip items={items} language={language} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <PrepRow key={item.menu_item_id} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
