import type { MenuItem, OrderItem } from '../api/types';

export interface CartEntry {
  menu_item_id: number;
  qty: number;
}

/**
 * Derives orderable cart entries from raw {itemId: qty} cart state and the
 * current menu. Entries for ids no longer present in the menu (a shopkeeper
 * deleted/hid the item while it sat in a student's cart) are silently
 * dropped — a stale entry here crashed checkout downstream before this
 * existed (STATUS.md R2).
 */
export function deriveCartEntries(
  cart: Record<number, number>,
  menuItems: MenuItem[] | undefined,
): CartEntry[] {
  if (!menuItems) return [];
  const validIds = new Set(menuItems.map((i) => i.id));
  return Object.entries(cart)
    .map(([id, qty]) => ({ menu_item_id: Number(id), qty }))
    .filter((e) => e.qty > 0 && validIds.has(e.menu_item_id));
}

/** Cart ids with qty > 0 that are no longer present in the current menu. */
export function staleCartIds(cart: Record<number, number>, menuItems: MenuItem[] | undefined): number[] {
  if (!menuItems) return [];
  const validIds = new Set(menuItems.map((i) => i.id));
  return Object.entries(cart)
    .filter(([id, qty]) => qty > 0 && !validIds.has(Number(id)))
    .map(([id]) => Number(id));
}

// ── Cart persistence (localStorage) ──────────────────────────────────────
// Shared between the Menu page (owns the live cart) and the Order status
// page (G3 "Order this again" writes here directly, since Menu is unmounted
// while viewing /order) — keeping the key/shape/date-scoping logic in one
// place is what makes that safe.

export const CART_STORAGE_KEY = 'khaao_cart_v2';

export interface StoredCart {
  date: string;
  items: Record<number, number>;
}

/** Local calendar date as YYYY-MM-DD — just a "is this cart from today or a
 * stale earlier day" heuristic, not the authoritative BUSINESS_TIMEZONE
 * boundary the backend uses for order tokens. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadStoredCart(): Record<number, number> {
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

/** Persists a cart keyed to today; an empty/all-zero cart clears storage
 * entirely rather than writing a pointless `{date, items: {}}` record. */
export function saveStoredCart(items: Record<number, number>): void {
  const hasItems = Object.values(items).some((qty) => qty > 0);
  if (!hasItems) {
    localStorage.removeItem(CART_STORAGE_KEY);
  } else {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ date: todayKey(), items } satisfies StoredCart));
  }
}

export interface ReorderOutcome {
  cart: Record<number, number>;
  addedCount: number;
  skippedNames: string[];
}

// Matches QtyStepper's default `max` and the backend's per-line cap
// (services/pool.go CreateOrder: `qty must be between 1 and 20`) — the same
// ceiling every other path to a cart quantity already enforces.
const MAX_ITEM_QTY = 20;

/**
 * Merges a past order's items into a cart (G3 "Order this again") — additive
 * on quantity, so reordering on top of an existing cart just tops it up.
 * Only items still on today's menu AND orderable are added; a rejected line
 * from the original order (dropped by the shop at the time) is never
 * re-added — everything else that can't be added is reported in
 * `skippedNames` so the caller can tell the student honestly what happened,
 * rather than silently dropping it. The merged quantity is clamped to
 * MAX_ITEM_QTY — additive merging with no ceiling could otherwise produce a
 * cart the backend refuses whole-cloth at checkout with a generic "qty must
 * be between 1 and 20" (naming no item), stranding the student. QtyStepper
 * already clamps silently at the same limit with no explanatory toast, so
 * doing the same here is consistent, not a new surprise.
 */
export function reorderIntoCart(
  cart: Record<number, number>,
  pastOrderItems: OrderItem[],
  menuItems: MenuItem[] | undefined,
): ReorderOutcome {
  const orderedItems = pastOrderItems.filter((item) => item.status !== 'rejected');

  if (!menuItems) {
    return { cart, addedCount: 0, skippedNames: orderedItems.map((item) => item.name) };
  }

  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const next = { ...cart };
  let addedCount = 0;
  const skippedNames: string[] = [];

  orderedItems.forEach((item) => {
    const menuItem = menuById.get(item.menu_item_id);
    if (!menuItem || !menuItem.orderable) {
      skippedNames.push(item.name);
      return;
    }
    const merged = (next[item.menu_item_id] ?? 0) + item.qty;
    next[item.menu_item_id] = Math.min(MAX_ITEM_QTY, merged);
    addedCount += 1;
  });

  return { cart: next, addedCount, skippedNames };
}
