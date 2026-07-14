import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { handoverItem, markPaid, markPrepDone, removeOrderItem } from '../api/shop';
import { ApiError } from '../api/client';
import type { Order, OrderItem } from '../api/types';
import { formatPrice } from '../lib/format';
import { Button } from './Button';
import { QtyStepper } from './QtyStepper';
import { OrderItemStatusBadge } from './StatusBadge';
import { Modal } from './Modal';
import { useToast } from './Toast';

function OrderModalItem({ order, item }: { order: Order; item: OrderItem }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const readyToGive = item.allocated_qty - item.handed_qty;
  const stillToCook = item.qty - item.allocated_qty;
  const fullyHanded = item.handed_qty >= item.qty;

  const [giveQty, setGiveQty] = useState(() => Math.min(1, Math.max(readyToGive, 1)));
  const [cookQty, setCookQty] = useState(() => Math.min(1, Math.max(stillToCook, 1)));

  // Live refetches (SSE / sibling actions) can shrink what's left to cook or
  // give; keep each selection inside its current bound so we never submit a
  // qty the server would reject.
  useEffect(() => {
    setGiveQty((prev) => Math.min(Math.max(prev, 1), Math.max(readyToGive, 1)));
  }, [readyToGive]);
  useEffect(() => {
    setCookQty((prev) => Math.min(Math.max(prev, 1), Math.max(stillToCook, 1)));
  }, [stillToCook]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['shop', 'prep'] });
  };

  const cookMutation = useMutation({
    mutationFn: (qty: number) => markPrepDone(item.menu_item_id, qty),
    onSuccess: invalidate,
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not mark cooked.', 'error'),
  });

  const handoverMutation = useMutation({
    mutationFn: (qty: number) => handoverItem(order.id, item.id, qty),
    onSuccess: invalidate,
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not hand over item.', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeOrderItem(order.id, item.id),
    onSuccess: () => {
      invalidate();
      showToast('Item removed.', 'success');
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not remove item.', 'error'),
  });

  const busy = cookMutation.isPending || handoverMutation.isPending || removeMutation.isPending;

  function handleRemove() {
    if (window.confirm(`Remove "${item.name}" from this order? Any prepared units go back to the pool.`)) {
      removeMutation.mutate();
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-steel/20 p-3">
      <div className="flex items-start gap-3">
        {item.photo_url && (
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-edge">
            <img src={item.photo_url} alt={item.name} className="h-full w-full object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-ink">
              {item.name} ×{item.qty}
            </p>
            <OrderItemStatusBadge status={item.status} />
          </div>
          <p className="tabular mt-0.5 text-xs text-ink/50">
            ready {item.allocated_qty}/{item.qty} · given {item.handed_qty}/{item.qty}
          </p>
        </div>
      </div>

      {fullyHanded ? (
        <p className="mt-2 text-sm font-semibold text-brand-dark">✓ Handed over</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {stillToCook > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-turmeric/30 bg-turmeric-pale/40 px-2.5 py-2">
              <span className="text-xs font-semibold text-turmeric-deep">{stillToCook} left to cook</span>
              <div className="flex items-center gap-2">
                <QtyStepper value={cookQty} onChange={setCookQty} min={1} max={stillToCook} disabled={busy} />
                <Button
                  size="md"
                  variant="secondary"
                  loading={cookMutation.isPending}
                  disabled={busy}
                  onClick={() => cookMutation.mutate(cookQty)}
                >
                  Mark cooked
                </Button>
              </div>
            </div>
          )}

          {readyToGive > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink/60">{readyToGive} ready</span>
                {readyToGive > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setGiveQty(readyToGive)}
                    className="rounded-md border border-edge px-1.5 py-0.5 text-[11px] font-semibold text-ink/60 transition hover:bg-ink/5 disabled:opacity-40"
                  >
                    All
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <QtyStepper value={giveQty} onChange={setGiveQty} min={1} max={readyToGive} disabled={busy} />
                <Button
                  size="md"
                  loading={handoverMutation.isPending}
                  disabled={busy}
                  onClick={() => handoverMutation.mutate(giveQty)}
                >
                  Give {giveQty}
                </Button>
              </div>
            </div>
          ) : (
            stillToCook > 0 && <p className="text-xs italic text-ink/40">Cook a unit to hand it over.</p>
          )}

          {item.handed_qty === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRemove}
              className="self-start text-[11px] font-semibold text-stamp/70 transition hover:text-stamp disabled:opacity-40"
            >
              Remove item
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const items = order.items.filter((i) => i.status !== 'rejected');
  const canCollect = order.status === 'awaiting_payment';

  const markPaidMutation = useMutation({
    mutationFn: () => markPaid(order.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['shop', 'history'] });
      showToast(`Order #${order.order_no} paid.`, 'success');
      onClose();
    },
    onError: (err) => showToast(err instanceof ApiError ? err.message : 'Could not collect payment.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`#${order.order_no} · ${order.student_name || 'Student'}`}
      subtitle={`${items.length} item${items.length === 1 ? '' : 's'} · ${formatPrice(order.total_price)}`}
      footer={
        <div className="flex flex-col gap-1.5">
          {!canCollect && (
            <p className="text-center text-xs text-ink/50">Hand over every item to collect payment.</p>
          )}
          <Button
            size="lg"
            fullWidth
            disabled={!canCollect}
            loading={markPaidMutation.isPending}
            onClick={() => markPaidMutation.mutate()}
          >
            Collect {formatPrice(order.total_price)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <OrderModalItem key={item.id} order={order} item={item} />
        ))}
      </div>
    </Modal>
  );
}
