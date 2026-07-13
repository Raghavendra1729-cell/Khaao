import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMenu } from '../../api/menu';
import { getActiveOrder, createOrder, type OrderItemInput } from '../../api/orders';
import { ApiError } from '../../api/client';
import type { MenuItem } from '../../api/types';
import { formatPrice } from '../../lib/format';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { MenuStatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { useNavigate } from 'react-router-dom';

function availabilityWindowText(item: MenuItem): string | null {
  if (!item.avail_from && !item.avail_to) return null;
  return `${item.avail_from ?? '00:00'} – ${item.avail_to ?? '23:59'}`;
}

export function Menu() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Record<number, number>>({});
  const [showCheckout, setShowCheckout] = useState(false);

  const menuQuery = useQuery({ queryKey: ['menu'], queryFn: getMenu });
  const activeOrderQuery = useQuery({ queryKey: ['orders', 'active'], queryFn: getActiveOrder });

  const activeOrder = activeOrderQuery.data ?? null;
  const hasActiveOrder = activeOrder !== null;

  const cartEntries = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ menu_item_id: Number(id), qty }))
        .filter((e) => e.qty > 0),
    [cart],
  );

  const cartTotal = useMemo(() => {
    const items = menuQuery.data ?? [];
    return cartEntries.reduce((sum, entry) => {
      const item = items.find((i) => i.id === entry.menu_item_id);
      return sum + (item ? item.price * entry.qty : 0);
    }, 0);
  }, [cartEntries, menuQuery.data]);

  const cartCount = cartEntries.reduce((sum, e) => sum + e.qty, 0);

  function setQty(itemId: number, qty: number) {
    setCart((prev) => ({ ...prev, [itemId]: qty }));
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      await createOrder(cartEntries as OrderItemInput[]);
    },
    onSuccess: () => {
      setCart({});
      setShowCheckout(false);
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['orders', 'history'] });
      showToast('Order placed — track it on Order status.', 'success');
      navigate('/order');
    },
    onError: (err) => {
      showToast(err instanceof ApiError ? err.message : 'Could not submit your order.', 'error');
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
    },
  });

  if (menuQuery.isLoading) return <FullPageSpinner />;

  if (menuQuery.isError) {
    return (
      <EmptyState
        title="Couldn't load the menu"
        hint={menuQuery.error instanceof ApiError ? menuQuery.error.message : 'Please try again.'}
        action={
          <Button variant="secondary" onClick={() => menuQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const items = menuQuery.data ?? [];

  return (
    <div className="pb-28">
      <h1 className="mb-1 text-2xl font-black tracking-tight text-ink">Today's menu</h1>
      <p className="mb-4 text-sm text-ink/60">Order now, pick up when it's ready.</p>

      {activeOrder && (
        <Link
          to="/order"
          className="mb-5 flex items-center justify-between rounded-2xl border border-brand bg-brand text-white px-4 py-3 text-sm font-semibold shadow-card hover:bg-brand-dark transition"
        >
          <span>
            You have an order in progress — token #{activeOrder.order_no}
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No items on the menu right now"
          hint="Check back soon — the canteen updates this list throughout the day."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const canAdd = item.orderable && !hasActiveOrder;
            const qty = cart[item.id] ?? 0;
            const availWindow = availabilityWindowText(item);
            return (
              <Card key={item.id} className="flex flex-col gap-3 p-4">
                <div className="flex h-28 items-center justify-center rounded-xl bg-brand-light text-3xl">
                  {item.photo_url ? (
                    <img
                      src={item.photo_url}
                      alt={item.name}
                      className="h-full w-full rounded-xl object-cover"
                    />
                  ) : (
                    <span aria-hidden>🍽️</span>
                  )}
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink">{item.name}</p>
                    <p className="tabular text-sm font-semibold text-brand-dark">
                      {formatPrice(item.price)}
                    </p>
                  </div>
                  <MenuStatusBadge status={item.status} />
                </div>

                {availWindow && <p className="text-xs text-ink/50">Available {availWindow}</p>}

                <div className="mt-auto flex items-center justify-end">
                  <QtyStepper value={qty} onChange={(next) => setQty(item.id, next)} disabled={!canAdd} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {cartCount > 0 && !hasActiveOrder && !showCheckout && (
        <div 
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-20 border-t border-sage bg-white/95 px-4 py-3 backdrop-blur cursor-pointer hover:bg-white"
          onClick={() => setShowCheckout(true)}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                {cartCount} item{cartCount > 1 ? 's' : ''}
              </p>
              <p className="tabular text-lg font-black text-brand-dark">{formatPrice(cartTotal)}</p>
            </div>
            <Button size="lg" type="button" onClick={(e) => { e.stopPropagation(); setShowCheckout(true); }}>
              View cart
            </Button>
          </div>
        </div>
      )}

      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/40 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full rounded-t-3xl bg-cream p-5 shadow-2xl sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-ink">Checkout</h2>
              <button 
                className="flex h-8 w-8 items-center justify-center rounded-full bg-sage/50 text-ink/70 hover:bg-sage hover:text-ink"
                onClick={() => setShowCheckout(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="mb-6 max-h-[50vh] overflow-y-auto divide-y divide-sage border-b border-t border-sage">
              {cartEntries.map((entry) => {
                const item = items.find((i) => i.id === entry.menu_item_id)!;
                return (
                  <div key={item.id} className="flex items-center justify-between py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-ink">{item.name}</span>
                      <span className="text-xs text-ink/60">{formatPrice(item.price)} each</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-brand-dark">{formatPrice(item.price * entry.qty)}</span>
                      <QtyStepper value={entry.qty} onChange={(next) => {
                        setQty(item.id, next);
                        if (cartCount - entry.qty + next === 0) setShowCheckout(false);
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="mb-6 flex items-center justify-between">
              <span className="text-lg font-bold text-ink">Total</span>
              <span className="text-2xl font-black text-brand-dark">{formatPrice(cartTotal)}</span>
            </div>

            <Button
              size="lg"
              fullWidth
              loading={submitMutation.isPending}
              onClick={() => {
                // Ask for notification permission from within the click gesture
                // (browsers ignore the request once the gesture activation lapses).
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                  void Notification.requestPermission();
                }
                submitMutation.mutate();
              }}
            >
              Place order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
