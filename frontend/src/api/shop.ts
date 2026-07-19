import { apiFetch } from './client';
import type { Diet, MenuItem, Order, PrepItem, ShopState, ShopStatus } from './types';

export interface MenuItemInput {
  name: string;
  price: number; // paise
  photo_url: string | null;
  avail_from: string | null;
  avail_to: string | null;
  is_available: boolean;
  // The backend REQUIRES diet on create/update (400 otherwise); these are
  // optional in TS only so the not-yet-updated menu form keeps compiling.
  // WP2's menu form must always send diet, and tags as a (possibly empty) array.
  diet?: Diet;
  tags?: string[];
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

export interface HistoryItemCount {
  name: string;
  qty: number;
}

export interface HistoryCustomer {
  name: string;
  order_count: number;
}

/** Day summary computed over completed (paid) orders. */
export interface HistoryInsights {
  order_count: number;
  item_counts: HistoryItemCount[]; // sorted qty desc
  customers: HistoryCustomer[]; // sorted order_count desc
}

export interface ShopHistory {
  orders: Order[];
  total_paid: number; // paise collected today
  insights: HistoryInsights;
}

/** Today's finished orders + paid total + insights, for counter reconciliation. */
export async function getShopHistory(date?: string): Promise<ShopHistory> {
  const query = date ? `?date=${date}` : '';
  return apiFetch<ShopHistory>(`/shop/history${query}`);
}

/** Public: the canteen's current open/paused/closed status. */
export async function getShopStatus(): Promise<ShopStatus> {
  return apiFetch<ShopStatus>('/shop-status');
}

/**
 * Shopkeeper: set the canteen status. Pass reopenAt (RFC3339) only when pausing.
 * The backend returns 409 ("Finish or cancel the N active order(s) first.") if
 * pausing/closing while any order is still active.
 */
export async function setShopStatus(state: ShopState, reopenAt?: string | null): Promise<ShopStatus> {
  return apiFetch<ShopStatus>('/shop/status', {
    method: 'POST',
    body: { state, reopen_at: reopenAt ?? null },
  });
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

export interface PhotoSignature {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  folder: string;
}

export async function getPhotoUploadSignature(): Promise<PhotoSignature> {
  return apiFetch<PhotoSignature>('/shop/menu/photo-signature', { method: 'POST' });
}

/** Uploads a menu item photo directly to Cloudinary (signed upload — the API
 * secret never reaches the browser) and returns the resulting secure_url. */
export async function uploadMenuItemPhoto(file: File): Promise<string> {
  const sig = await getPhotoUploadSignature();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', sig.api_key);
  formData.append('timestamp', sig.timestamp.toString());
  formData.append('signature', sig.signature);
  formData.append('folder', sig.folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error('Failed to upload photo');
  }

  const data = await res.json();
  return data.secure_url;
}

export async function getVapidPublicKey(): Promise<{ public_key: string }> {
  return apiFetch<{ public_key: string }>('/push/vapid-public-key');
}

export async function subscribeToPush(endpoint: string, p256dh: string, auth: string): Promise<void> {
  await apiFetch('/push/subscribe', {
    method: 'POST',
    body: { endpoint, keys: { p256dh, auth } },
  });
}
