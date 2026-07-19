import type { MenuItem } from '../api/types';

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
