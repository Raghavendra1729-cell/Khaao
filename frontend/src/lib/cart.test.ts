import { describe, expect, it } from 'vitest';
import { deriveCartEntries, staleCartIds } from './cart';
import type { MenuItem } from '../api/types';

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
