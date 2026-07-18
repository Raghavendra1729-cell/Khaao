import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMenu } from '../../api/menu';
import { getActiveOrder, createOrder, type OrderItemInput } from '../../api/orders';
import { getShopStatus } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { MenuItem } from '../../api/types';
import { formatPrice } from '../../lib/format';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyState } from '../../components/EmptyState';
import { FullPageSpinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';

import { TrendingRail } from '../../components/TrendingRail';
import { DietFilter, type DietFilterValue } from '../../components/DietFilter';
import { MenuItemCard } from '../../components/MenuItemCard';

const CART_STORAGE_KEY = 'khaao_cart_v2';

interface StoredCart {
  date: string;
  items: Record<number, number>;
}

/** Local calendar date as YYYY-MM-DD — just a "is this cart from today or a
 * stale earlier day" heuristic, not the authoritative BUSINESS_TIMEZONE
 * boundary the backend uses for order tokens. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadStoredCart(): Record<number, number> {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredCart;
    if (parsed.date !== todayKey()) return {};
    return parsed.items ?? {};
  } catch (e) {
    return {};
  }
}

function formatReopenTime(isoString: string | null): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
  } catch (e) {
    return '';
  }
}

export function Menu() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  // localStorage, not sessionStorage — sessionStorage dies with the process,
  // so the OS reclaiming a backgrounded installed PWA (e.g. the student
  // switched to WhatsApp mid-cart) silently lost everything. Keyed by
  // today's date so a cart from a previous day is never resurrected.
  const [cart, setCart] = useState<Record<number, number>>(loadStoredCart);
  const [showCheckout, setShowCheckout] = useState(false);
  const [dietFilter, setDietFilter] = useState<DietFilterValue>('all');
  const [activeCategory, setActiveCategory] = useState<string>('');

  useEffect(() => {
    const hasItems = Object.values(cart).some((qty) => qty > 0);
    if (!hasItems) {
      localStorage.removeItem(CART_STORAGE_KEY);
    } else {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ date: todayKey(), items: cart } satisfies StoredCart));
    }
  }, [cart]);

  const menuQuery = useQuery({ queryKey: ['menu'], queryFn: getMenu });
  const activeOrderQuery = useQuery({ queryKey: ['orders', 'active'], queryFn: getActiveOrder });
  const shopStatusQuery = useQuery({ queryKey: ['shop-status'], queryFn: getShopStatus });

  const activeOrder = activeOrderQuery.data ?? null;
  const hasActiveOrder = activeOrder !== null;
  const shopStatus = shopStatusQuery.data ?? { state: 'open', reopen_at: null };
  const isShopOpen = shopStatus.state === 'open';

  // Only ever surface entries for items still present in the current menu —
  // a shopkeeper can delete/hide an item that's sitting in a student's cart
  // (menu refetches live via SSE menu_update), and a stale entry here would
  // crash checkout downstream.
  const cartEntries = useMemo(() => {
    const items = menuQuery.data;
    if (!items) return [];
    const validIds = new Set(items.map((i) => i.id));
    return Object.entries(cart)
      .map(([id, qty]) => ({ menu_item_id: Number(id), qty }))
      .filter((e) => e.qty > 0 && validIds.has(e.menu_item_id));
  }, [cart, menuQuery.data]);

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

  // Prune cart entries that fell out of the menu and let the student know.
  useEffect(() => {
    const items = menuQuery.data;
    if (!items) return;
    const validIds = new Set(items.map((i) => i.id));
    const staleIds = Object.entries(cart)
      .filter(([id, qty]) => qty > 0 && !validIds.has(Number(id)))
      .map(([id]) => Number(id));
    if (staleIds.length === 0) return;
    setCart((prev) => {
      const next = { ...prev };
      staleIds.forEach((id) => {
        delete next[id];
      });
      return next;
    });
    showToast('Some items are no longer available and were removed from your cart.', 'error');
  }, [cart, menuQuery.data, showToast]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      await createOrder(cartEntries as OrderItemInput[]);
    },
    onSuccess: () => {
      setCart({});
      localStorage.removeItem(CART_STORAGE_KEY);
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

  const items = menuQuery.data ?? [];

  const hasRealCounts = useMemo(() => {
    return items.some((item) => item.order_count_today > 0);
  }, [items]);

  const trendingItems = useMemo(() => {
    const sorted = [...items];
    if (hasRealCounts) {
      sorted.sort((a, b) => {
        if (b.order_count_today !== a.order_count_today) {
          return b.order_count_today - a.order_count_today;
        }
        return b.id - a.id;
      });
    } else {
      sorted.sort((a, b) => b.id - a.id);
    }
    return sorted.slice(0, 5);
  }, [items, hasRealCounts]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (dietFilter === 'all') return true;
      return item.diet === dietFilter;
    });
  }, [items, dietFilter]);

  const categories = useMemo(() => {
    const tagsSet = new Set<string>();
    filteredItems.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          const trimmed = tag.trim();
          if (trimmed) {
            tagsSet.add(trimmed);
          }
        });
      }
    });

    const sortedTags = Array.from(tagsSet).sort((a, b) => a.localeCompare(b));
    const hasUntagged = filteredItems.some((item) => !item.tags || item.tags.length === 0);

    return {
      tags: sortedTags,
      hasUntagged,
    };
  }, [filteredItems]);

  const allCategories = useMemo(() => {
    const list: { name: string; items: MenuItem[] }[] = [];
    categories.tags.forEach((tag) => {
      const matching = filteredItems.filter((item) => item.tags.includes(tag));
      if (matching.length > 0) {
        list.push({ name: tag, items: matching });
      }
    });
    if (categories.hasUntagged) {
      const untagged = filteredItems.filter((item) => !item.tags || item.tags.length === 0);
      if (untagged.length > 0) {
        list.push({ name: 'Others', items: untagged });
      }
    }
    return list;
  }, [categories, filteredItems]);

  useEffect(() => {
    if (allCategories.length === 0) return;

    if (!activeCategory || !allCategories.some((c) => c.name === activeCategory)) {
      setActiveCategory(allCategories[0].name);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries.find((entry) => entry.isIntersecting);
        if (visibleEntry) {
          const catName = visibleEntry.target.id.replace('category-', '');
          setActiveCategory(catName);
        }
      },
      {
        rootMargin: '-100px 0px -60% 0px',
      }
    );

    allCategories.forEach((cat) => {
      const el = document.getElementById(`category-${cat.name}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [allCategories, activeCategory]);

  const scrollToCategory = (name: string) => {
    const element = document.getElementById(`category-${name}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (menuQuery.isLoading || shopStatusQuery.isLoading) return <FullPageSpinner />;

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

  return (
    <div className="pb-28">
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Today's menu</h1>
      <p className="mb-4 text-sm text-ink/60">Order now, pick up when it's ready.</p>

      {shopStatus.state === 'paused' && (
        <div className="mb-5 rounded-2xl border border-dashed border-turmeric bg-turmeric-pale/40 px-4 py-3 text-sm font-semibold text-turmeric-deep shadow-card">
          On a break — back at {formatReopenTime(shopStatus.reopen_at) || '--:--'}
        </div>
      )}

      {shopStatus.state === 'closed' && (
        <div className="mb-5 rounded-2xl border border-dashed border-stamp bg-stamp-light/40 px-4 py-3 text-sm font-semibold text-stamp-dark shadow-card">
          The canteen is closed — no new orders right now
        </div>
      )}

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
        <>
          <TrendingRail
            items={trendingItems}
            hasRealCounts={hasRealCounts}
            qtyFor={(id) => cart[id] ?? 0}
            onQtyChange={setQty}
            hasActiveOrder={hasActiveOrder}
            canOrder={isShopOpen}
          />

          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-ink">
              Main Menu
            </h2>
            <DietFilter value={dietFilter} onChange={setDietFilter} />
          </div>

          {filteredItems.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink/60">No items match your filter.</p>
            </div>
          ) : (
            <>
              {allCategories.length > 0 && (
                <div className="sticky top-14 z-10 -mx-4 mb-4 bg-steel/95 px-4 py-2 backdrop-blur border-b border-edge overflow-x-auto no-scrollbar flex gap-2">
                  {allCategories.map((cat) => {
                    const isActive = activeCategory === cat.name;
                    return (
                      <button
                        key={cat.name}
                        type="button"
                        onClick={() => scrollToCategory(cat.name)}
                        className={`shrink-0 rounded-full border px-3.5 py-1 text-xs font-semibold uppercase tracking-wider transition ${
                          isActive
                            ? 'bg-brand text-white border-brand shadow-sm'
                            : 'bg-paper text-ink/75 border-edge hover:bg-edge/40'
                        }`}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {allCategories.map((cat) => (
                <section
                  key={cat.name}
                  id={`category-${cat.name}`}
                  className="mb-8 scroll-mt-28 animate-rail-in"
                >
                  <h3 className="mb-3 font-display text-xs font-bold uppercase tracking-wider text-ink/50">
                    {cat.name} ({cat.items.length})
                  </h3>
                  <div className="flex flex-col gap-3">
                    {cat.items.map((item) => {
                      const qty = cart[item.id] ?? 0;
                      const canAdd = item.orderable && !hasActiveOrder && isShopOpen;
                      const disableStepper = hasActiveOrder;
                      const disableIncrease = !canAdd;
                      return (
                        <MenuItemCard
                          key={item.id}
                          item={item}
                          qty={qty}
                          onQtyChange={(next) => setQty(item.id, next)}
                          disableStepper={disableStepper}
                          disableIncrease={disableIncrease}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}

      {cartCount > 0 && !hasActiveOrder && !showCheckout && isShopOpen && (
        <div
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-50 border-t border-edge bg-paper/95 px-4 py-3 backdrop-blur cursor-pointer hover:bg-paper"
          onClick={() => setShowCheckout(true)}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                {cartCount} item{cartCount > 1 ? 's' : ''}
              </p>
              <p className="tabular font-display text-lg font-bold text-brand-dark">{formatPrice(cartTotal)}</p>
            </div>
            <Button size="lg" type="button" onClick={(e) => { e.stopPropagation(); setShowCheckout(true); }}>
              View cart
            </Button>
          </div>
        </div>
      )}

      {showCheckout && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-ink/40 backdrop-blur-sm sm:items-center sm:justify-center"
          onClick={() => setShowCheckout(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t-2 border-dashed border-ink/20 bg-paper p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:border-t-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-ink/70">
                Your order
              </h2>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-edge/50 text-ink/70 hover:bg-edge hover:text-ink"
                onClick={() => setShowCheckout(false)}
              >
                ✕
              </button>
            </div>

            <div className="mb-6 max-h-[50vh] overflow-y-auto divide-y divide-edge border-b border-t border-edge">
              {cartEntries.map((entry) => {
                const item = items.find((i) => i.id === entry.menu_item_id);
                if (!item) return null;
                return (
                  <div key={item.id} className="flex items-center justify-between py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-ink">
                        {item.name}
                      </span>
                      <span className="text-xs text-ink/60">{formatPrice(item.price)} each</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular font-display text-sm font-bold text-brand-dark">
                        {formatPrice(item.price * entry.qty)}
                      </span>
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
              <span className="font-display text-2xl font-bold text-brand-dark">{formatPrice(cartTotal)}</span>
            </div>

            <Button
              size="lg"
              fullWidth
              loading={submitMutation.isPending}
              disabled={!isShopOpen}
              onClick={() => {
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
