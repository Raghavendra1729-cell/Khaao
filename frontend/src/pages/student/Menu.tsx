import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMenu } from '../../api/menu';
import { getActiveOrder, createOrder, type OrderItemInput } from '../../api/orders';
import { getShopStatus } from '../../api/shop';
import { ApiError } from '../../api/client';
import type { MenuItem } from '../../api/types';
import { formatPrice, formatTime } from '../../lib/format';
import { deriveCartEntries, staleCartIds } from '../../lib/cart';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/QtyStepper';
import { EmptyState } from '../../components/EmptyState';
import { EmptyPlateIcon } from '../../components/EmptyStateIcons';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';

import { TrendingRail } from '../../components/TrendingRail';
import { DietFilter, type DietFilterValue } from '../../components/DietFilter';
import { MenuItemCard } from '../../components/MenuItemCard';
import { MenuSkeleton } from '../../components/MenuSkeleton';

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

function prefersReducedMotion(): boolean {
  // Optional chaining, matching lib/firebase.ts's pattern — jsdom (tests) and
  // some older webviews don't implement matchMedia at all (§ 9.1.9: feature-
  // detect everything).
  return Boolean(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
}

function loadStoredCart(): Record<number, number> {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredCart;
    if (parsed.date !== todayKey()) return {};
    return parsed.items ?? {};
  } catch {
    return {};
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
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ date: todayKey(), items: cart } satisfies StoredCart),
      );
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
  // crash checkout downstream. Logic lives in lib/cart.ts so it's directly
  // unit-testable without rendering this whole page.
  const cartEntries = useMemo(() => deriveCartEntries(cart, menuQuery.data), [cart, menuQuery.data]);

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
    const staleIds = staleCartIds(cart, menuQuery.data);
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
      // F10: was inside the Place-order click, landing the native permission
      // dialog at the same instant as submit + navigation. Ask only once the
      // order actually exists, after the student has already landed on
      // Order status.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    },
    onError: (err) => {
      showToast(err instanceof ApiError ? err.message : 'Could not submit your order.', 'error');
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
    },
  });

  // useMemo, not `?? []` directly — a fresh [] literal on every render (when
  // menuQuery.data is still undefined) would give the useMemo hooks below a
  // new reference every time, defeating their memoization even though
  // nothing logically changed.
  const items = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);

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

  // Split from the observer effect below (F7): this one only ever needs to
  // run when the category list itself changes (e.g. the diet filter drops a
  // category out from under the current selection). A functional update
  // means it doesn't need to read `activeCategory` from render scope, so it
  // doesn't need it as a dependency either.
  useEffect(() => {
    if (allCategories.length === 0) return;
    setActiveCategory((prev) =>
      prev && allCategories.some((c) => c.name === prev) ? prev : allCategories[0].name,
    );
  }, [allCategories]);

  // The scroll-spy observer. Deliberately keyed only on `allCategories` — it
  // also *sets* activeCategory from its own callback, so listing
  // activeCategory as a dependency here would tear the observer down and
  // rebuild it on every single scroll transition (F7).
  useEffect(() => {
    if (allCategories.length === 0) return;

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
      },
    );

    allCategories.forEach((cat) => {
      const el = document.getElementById(`category-${cat.name}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [allCategories]);

  // Keep the highlighted chip visible inside its own horizontal scroll
  // strip as the active category changes on long menus (F7).
  useEffect(() => {
    if (!activeCategory) return;
    const chip = document.getElementById(`chip-${activeCategory}`);
    // jsdom (tests) doesn't implement scrollIntoView at all — feature-detect
    // rather than assume (§ 9.1.9).
    if (!chip || typeof chip.scrollIntoView !== 'function') return;
    chip.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeCategory]);

  const scrollToCategory = (name: string) => {
    const element = document.getElementById(`category-${name}`);
    if (element) {
      element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  };

  if (menuQuery.isLoading || shopStatusQuery.isLoading) return <MenuSkeleton />;

  // isError also fires after a failed *background* refetch, while data
  // still holds the last good response — only replace the screen with an
  // error state if there's nothing cached to show instead (R25).
  if (menuQuery.isError && menuQuery.data === undefined) {
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
          On a break — back at {formatTime(shopStatus.reopen_at) || '--:--'}
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
          <span>You have an order in progress — token #{activeOrder.order_no}</span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<EmptyPlateIcon />}
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
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-ink">Main Menu</h2>
            <DietFilter value={dietFilter} onChange={setDietFilter} />
          </div>

          {filteredItems.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-ink/60">No items match your filter.</p>
            </div>
          ) : (
            <>
              {allCategories.length > 0 && (
                // F1: top-14 alone ignores the notch inset the header already
                // respects via pt-safe — this bar would slide under it in
                // installed-PWA standalone mode on a notched iPhone.
                <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-10 -mx-4 mb-4 bg-steel/95 px-4 py-2 backdrop-blur border-b border-edge overflow-x-auto no-scrollbar flex gap-2">
                  {allCategories.map((cat) => {
                    const isActive = activeCategory === cat.name;
                    return (
                      <button
                        key={cat.name}
                        id={`chip-${cat.name}`}
                        type="button"
                        onClick={() => scrollToCategory(cat.name)}
                        // F2: visual chip stays compact; the invisible
                        // ::before expands the real hit target to >=44px.
                        className={`relative shrink-0 rounded-full border px-3.5 py-1 text-xs font-semibold uppercase tracking-wider transition before:absolute before:-inset-3 before:content-[''] ${
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

      {/* F6: the whole bar is one real <button> now (was a clickable <div>
          nesting a <Button> that stopPropagation()'d to do the same thing —
          not keyboard reachable, no role, invalid nesting once you think
          about it as a button-in-button). Not gated on isShopOpen anymore
          either: if the shop pauses/closes with items sitting in the cart,
          the student can still open it and see what they picked — the Modal
          below already disables "Place order" while the shop isn't open. */}
      {cartCount > 0 && !hasActiveOrder && !showCheckout && (
        <button
          type="button"
          onClick={() => setShowCheckout(true)}
          className="animate-slide-up fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+56px)] z-50 w-full border-t border-edge bg-paper/95 px-4 py-3 text-left backdrop-blur transition hover:bg-paper active:bg-edge/40"
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                {cartCount} item{cartCount > 1 ? 's' : ''}
              </p>
              <p className="tabular font-display text-lg font-bold text-brand-dark">
                {formatPrice(cartTotal)}
              </p>
            </div>
            <span className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-lg font-semibold text-white shadow-sm">
              View cart
            </span>
          </div>
        </button>
      )}

      {showCheckout && (
        <Modal
          open
          onClose={() => setShowCheckout(false)}
          title="Your order"
          // F6: the cart bar can now open this Modal even while the shop
          // isn't open (view-only), so the disabled "Place order" button
          // below is reachable in a state that used to be impossible — spell
          // out why it's disabled instead of leaving a mute button.
          subtitle={
            !isShopOpen
              ? shopStatus.state === 'paused'
                ? `On a break — back at ${formatTime(shopStatus.reopen_at) || '--:--'}. You can still review your cart.`
                : 'The canteen is closed — no new orders right now. You can still review your cart.'
              : undefined
          }
          footer={
            <>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-bold text-ink">Total</span>
                <span className="font-display text-2xl font-bold text-brand-dark">
                  {formatPrice(cartTotal)}
                </span>
              </div>
              <Button
                size="lg"
                fullWidth
                loading={submitMutation.isPending}
                disabled={!isShopOpen}
                onClick={() => submitMutation.mutate()}
              >
                Place order
              </Button>
            </>
          }
        >
          <div className="divide-y divide-edge">
            {cartEntries.map((entry) => {
              const item = items.find((i) => i.id === entry.menu_item_id);
              if (!item) return null;
              return (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="font-semibold text-ink">{item.name}</span>
                    <span className="text-xs text-ink/60">{formatPrice(item.price)} each</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular font-display text-sm font-bold text-brand-dark">
                      {formatPrice(item.price * entry.qty)}
                    </span>
                    <QtyStepper
                      value={entry.qty}
                      onChange={(next) => {
                        setQty(item.id, next);
                        if (cartCount - entry.qty + next === 0) setShowCheckout(false);
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}
