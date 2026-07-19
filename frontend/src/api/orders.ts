import { ApiError, apiFetch } from './client';
import type { Order } from './types';

export interface OrderItemInput {
  menu_item_id: number;
  qty: number;
}

export async function createOrder(items: OrderItemInput[]): Promise<Order> {
  const res = await apiFetch<{ order: Order }>('/orders', {
    method: 'POST',
    body: { items },
  });
  return res.order;
}

/** Returns null when there is no active order (API responds 404). */
export async function getActiveOrder(): Promise<Order | null> {
  try {
    const res = await apiFetch<{ order: Order }>('/orders/active');
    return res.order;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getOrderHistory(): Promise<Order[]> {
  const res = await apiFetch<{ orders: Order[] }>('/orders');
  return res.orders;
}

export async function cancelOrder(orderId: number): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/orders/${orderId}/cancel`, {
    method: 'POST',
  });
  return res.order;
}

export async function submitRatings(
  orderId: number,
  ratings: { order_item_id: number; stars: number }[],
): Promise<void> {
  await apiFetch(`/orders/${orderId}/ratings`, {
    method: 'POST',
    body: { ratings },
  });
}
