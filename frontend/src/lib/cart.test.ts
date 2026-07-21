import { describe, expect, it } from 'vitest';
import { deriveCartEntries, reorderIntoCart, staleCartIds } from './cart';
import type { MenuItem, OrderItem } from '../api/types';

function menuItem(overrides: Partial<MenuItem> & { id: number }): MenuItem {
  return {
    name: `Item ${overrides.id}`,
    price: 100,
    photo_url: '',
    diet: 'veg',
    tags: [],
    is_available: true,
    avail_from: null,
    avail_to: null,
    out_of_stock: false,
    status: 'available',
    orderable: true,
    order_count_today: 0,
    avg_rating: 0,
    rating_count: 0,
    ...overrides,
  };
}

function orderItem(overrides: Partial<OrderItem> & { id: number; menu_item_id: number }): OrderItem {
  return {
    name: `Item ${overrides.menu_item_id}`,
    photo_url: null,
    qty: 1,
    allocated_qty: 1,
    handed_qty: 1,
    status: 'handed_over',
    price_each: 100,
    ...overrides,
  };
}

describe('deriveCartEntries', () => {
  it('returns entries for ids present in the menu with qty > 0', () => {
    const cart = { 1: 2, 2: 1 };
    const menu = [menuItem({ id: 1 }), menuItem({ id: 2 })];
    expect(deriveCartEntries(cart, menu)).toEqual([
      { menu_item_id: 1, qty: 2 },
      { menu_item_id: 2, qty: 1 },
    ]);
  });

  it('drops entries for a menu item that no longer exists (R2: shopkeeper deleted/hid it)', () => {
    const cart = { 1: 2, 99: 3 };
    const menu = [menuItem({ id: 1 })]; // item 99 no longer in the menu
    expect(deriveCartEntries(cart, menu)).toEqual([{ menu_item_id: 1, qty: 2 }]);
  });

  it('drops zero/negative-qty entries', () => {
    const cart = { 1: 0, 2: -1, 3: 1 };
    const menu = [menuItem({ id: 1 }), menuItem({ id: 2 }), menuItem({ id: 3 })];
    expect(deriveCartEntries(cart, menu)).toEqual([{ menu_item_id: 3, qty: 1 }]);
  });

  it('returns an empty array while the menu has not loaded yet', () => {
    expect(deriveCartEntries({ 1: 2 }, undefined)).toEqual([]);
  });

  it('returns an empty array for an empty cart', () => {
    expect(deriveCartEntries({}, [menuItem({ id: 1 })])).toEqual([]);
  });
});

describe('staleCartIds', () => {
  it('finds cart ids no longer present in the menu', () => {
    const cart = { 1: 2, 99: 3 };
    const menu = [menuItem({ id: 1 })];
    expect(staleCartIds(cart, menu)).toEqual([99]);
  });

  it('ignores zero-qty entries — nothing to prune there', () => {
    const cart = { 1: 0 };
    const menu = [menuItem({ id: 2 })];
    expect(staleCartIds(cart, menu)).toEqual([]);
  });

  it('returns empty when everything in the cart is still on the menu', () => {
    const cart = { 1: 2, 2: 1 };
    const menu = [menuItem({ id: 1 }), menuItem({ id: 2 })];
    expect(staleCartIds(cart, menu)).toEqual([]);
  });

  it('returns an empty array while the menu has not loaded yet', () => {
    expect(staleCartIds({ 1: 2 }, undefined)).toEqual([]);
  });
});

describe('reorderIntoCart', () => {
  it('adds items that are still on the menu and orderable', () => {
    const pastItems = [
      orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 2 }),
      orderItem({ id: 2, menu_item_id: 2, name: 'Coffee', qty: 1 }),
    ];
    const menu = [menuItem({ id: 1, name: 'Dosa' }), menuItem({ id: 2, name: 'Coffee' })];
    const result = reorderIntoCart({}, pastItems, menu);
    expect(result).toEqual({ cart: { 1: 2, 2: 1 }, addedCount: 2, skippedNames: [] });
  });

  it('merges additively into an existing cart', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 2 })];
    const menu = [menuItem({ id: 1, name: 'Dosa' })];
    const result = reorderIntoCart({ 1: 1, 5: 3 }, pastItems, menu);
    expect(result.cart).toEqual({ 1: 3, 5: 3 });
    expect(result.addedCount).toBe(1);
  });

  it('skips an item no longer on the menu and reports its name', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 99, name: 'Vada Pav', qty: 1 })];
    const result = reorderIntoCart({}, pastItems, [menuItem({ id: 1, name: 'Dosa' })]);
    expect(result).toEqual({ cart: {}, addedCount: 0, skippedNames: ['Vada Pav'] });
  });

  it('skips an item that is on the menu but not orderable', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 1 })];
    const menu = [menuItem({ id: 1, name: 'Dosa', orderable: false })];
    const result = reorderIntoCart({}, pastItems, menu);
    expect(result).toEqual({ cart: {}, addedCount: 0, skippedNames: ['Dosa'] });
  });

  it('never re-adds a rejected line, and does not report it as skipped either', () => {
    const pastItems = [
      orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 1 }),
      orderItem({ id: 2, menu_item_id: 2, name: 'Vada', qty: 1, status: 'rejected' }),
    ];
    const menu = [menuItem({ id: 1, name: 'Dosa' }), menuItem({ id: 2, name: 'Vada' })];
    const result = reorderIntoCart({}, pastItems, menu);
    expect(result).toEqual({ cart: { 1: 1 }, addedCount: 1, skippedNames: [] });
  });

  it('reports everything as skipped when the menu has not loaded yet', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 1 })];
    const result = reorderIntoCart({}, pastItems, undefined);
    expect(result).toEqual({ cart: {}, addedCount: 0, skippedNames: ['Dosa'] });
  });

  it('clamps the merged quantity at 20 — matches QtyStepper max and the backend per-line cap', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 15 })];
    const menu = [menuItem({ id: 1, name: 'Dosa' })];
    // An existing cart already at 10 + a past order of 15 would merge to 25
    // (over the 20 cap) without clamping — this used to leave a cart that
    // silently failed checkout with a generic backend error naming no item.
    const result = reorderIntoCart({ 1: 10 }, pastItems, menu);
    expect(result).toEqual({ cart: { 1: 20 }, addedCount: 1, skippedNames: [] });
  });

  it('clamps even a single reorder that alone would exceed 20', () => {
    const pastItems = [orderItem({ id: 1, menu_item_id: 1, name: 'Dosa', qty: 20 })];
    const menu = [menuItem({ id: 1, name: 'Dosa' })];
    const result = reorderIntoCart({ 1: 5 }, pastItems, menu);
    expect(result.cart).toEqual({ 1: 20 });
  });
});
