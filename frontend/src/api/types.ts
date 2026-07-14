// Shared types matching the Khaao API contract (see docs/SPEC.md).
// Money is always an integer number of paise. Timestamps are RFC3339 strings.

export type Role = 'student' | 'shopkeeper';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  photo_url: string;
}

/** Which sign-in methods the server offers (GET /api/auth/config). */
export interface AuthConfig {
  allowed_email_domain: string;
}

export type MenuItemStatus = 'available' | 'time_limited' | 'out_of_stock' | 'unavailable';

export type Diet = 'veg' | 'non_veg';

export interface MenuItem {
  id: number;
  name: string;
  price: number; // paise
  photo_url: string | null;
  diet: Diet;
  tags: string[]; // always an array (never null); [] when untagged
  is_available: boolean;
  avail_from: string | null; // "HH:MM" 24h, or null
  avail_to: string | null;
  out_of_stock: boolean;
  status: MenuItemStatus;
  orderable: boolean;
  order_count_today: number; // ordered qty today (non-rejected orders); trending
}

/** Whether the canteen is accepting orders (GET /api/shop-status). */
export type ShopState = 'open' | 'paused' | 'closed';

export interface ShopStatus {
  state: ShopState;
  reopen_at: string | null; // RFC3339, set only while paused; null otherwise
}

export type OrderStatus =
  | 'submitted'
  | 'preparing'
  | 'partially_ready'
  | 'ready'
  | 'awaiting_payment'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type OrderItemStatus = 'pending' | 'queued' | 'allocated' | 'rejected' | 'handed_over';

export interface OrderItem {
  id: number;
  menu_item_id: number;
  name: string;
  photo_url: string | null;
  qty: number;
  allocated_qty: number;
  handed_qty: number;
  status: OrderItemStatus;
  price_each: number; // paise
}

export interface Order {
  id: number;
  order_no: number; // daily token number, resets each day
  order_date: string; // "YYYY-MM-DD"
  status: OrderStatus;
  total_price: number; // paise
  paid: boolean;
  paid_at: string | null;
  created_at: string;
  ready_at: string | null;
  expires_at: string | null;
  student_name: string; // "" for the student's own view
  student_email: string; // "" for the student's own view
  items: OrderItem[];
}

export interface PrepItem {
  menu_item_id: number;
  name: string;
  remaining_qty: number; // to cook
  pool_qty: number; // unallocated done units
}

/** Active order statuses per the one-order rule (SPEC.md). */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'submitted',
  'preparing',
  'partially_ready',
  'ready',
  'awaiting_payment',
];

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as OrderStatus[]).includes(status);
}
