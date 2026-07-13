import { apiFetch } from './client';
import type { MenuItem, Order, PrepItem } from './types';

export interface MenuItemInput {
  name: string;
  price: number; // paise
  photo_url: string | null;
  avail_from: string | null;
  avail_to: string | null;
  is_available: boolean;
}

export async function getShopMenu(): Promise<MenuItem[]> {
  const res = await apiFetch<{ items: MenuItem[] }>('/shop/menu');
  return res.items;
}

export async function createMenuItem(input: MenuItemInput): Promise<MenuItem> {
  const res = await apiFetch<{ item: MenuItem }>('/shop/menu', {
    method: 'POST',
    body: input,
  });
  return res.item;
}

export async function updateMenuItem(id: number, input: MenuItemInput): Promise<MenuItem> {
  const res = await apiFetch<{ item: MenuItem }>(`/shop/menu/${id}`, {
    method: 'PUT',
    body: input,
  });
  return res.item;
}

export async function deleteMenuItem(id: number): Promise<void> {
  await apiFetch<void>(`/shop/menu/${id}`, { method: 'DELETE' });
}

export async function setMenuItemStock(id: number, outOfStock: boolean): Promise<MenuItem> {
  const res = await apiFetch<{ item: MenuItem }>(`/shop/menu/${id}/stock`, {
    method: 'POST',
    body: { out_of_stock: outOfStock },
  });
  return res.item;
}

export interface ShopOrders {
  incoming: Order[];
  in_progress: Order[];
  awaiting_payment: Order[];
}

export async function getShopOrders(): Promise<ShopOrders> {
  return apiFetch<ShopOrders>('/shop/orders');
}

export interface ShopHistory {
  orders: Order[];
  total_paid: number; // paise collected today
}

/** Today's finished orders + paid total, for counter reconciliation. */
export async function getShopHistory(date?: string): Promise<ShopHistory> {
  const query = date ? `?date=${date}` : '';
  return apiFetch<ShopHistory>(`/shop/history${query}`);
}

export async function acceptOrder(id: number, rejectedItemIds: number[]): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/shop/orders/${id}/accept`, {
    method: 'POST',
    body: { rejected_item_ids: rejectedItemIds },
  });
  return res.order;
}

export async function rejectOrder(id: number): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/shop/orders/${id}/reject`, {
    method: 'POST',
  });
  return res.order;
}

export async function handoverItem(orderId: number, itemId: number, qty = 1): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/shop/orders/${orderId}/items/${itemId}/handover`, {
    method: 'POST',
    body: { qty },
  });
  return res.order;
}

/** Remove a line from an accepted order; prepared units return to the pool. */
export async function removeOrderItem(orderId: number, itemId: number): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/shop/orders/${orderId}/items/${itemId}`, {
    method: 'DELETE',
  });
  return res.order;
}

export async function markPaid(orderId: number): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/shop/orders/${orderId}/paid`, {
    method: 'POST',
  });
  return res.order;
}

export async function getPrep(): Promise<PrepItem[]> {
  const res = await apiFetch<{ items: PrepItem[] }>('/shop/prep');
  return res.items;
}

export async function markPrepDone(menuItemId: number, qty = 1): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/shop/prep/${menuItemId}/done`, {
    method: 'POST',
    body: { qty },
  });
}

export async function closeDay(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/shop/day/close', { method: 'POST' });
}
