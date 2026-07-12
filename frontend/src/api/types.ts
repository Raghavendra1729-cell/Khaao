// Shared types matching the Khaao API contract (see docs/SPEC.md).
// Money is always an integer number of paise. Timestamps are RFC3339 strings.

export type Role = 'student' | 'shopkeeper' | 'guest';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/** Which sign-in methods the server offers (GET /api/auth/config). */
export interface AuthConfig {
  google_enabled: boolean;
  google_client_id: string;
  google_allowed_domains: string[];
  guest_enabled: boolean;
  password_signup_enabled: boolean;
}

export type MenuItemStatus = 'available' | 'time_limited' | 'out_of_stock' | 'unavailable';

export interface MenuItem {
  id: number;
  name: string;
  price: number; // paise
  photo_url: string | null;
  is_available: boolean;
  avail_from: string | null; // "HH:MM" 24h, or null
  avail_to: string | null;
  out_of_stock: boolean;
  status: MenuItemStatus;
  orderable: boolean;
}

export type OrderStatus =
  | 'submitted'
  | 'preparing'
  | 'partially_ready'
  | 'ready'
  | 'picked'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type OrderItemStatus = 'pending' | 'queued' | 'allocated' | 'rejected' | 'handed_over';

export interface OrderItem {
  id: number;
  menu_item_id: number;
  name: string;
  qty: number;
  allocated_qty: number;
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
  created_at: string;
  ready_at: string | null;
  expires_at: string | null;
  student_name: string; // "" for the student's own view
  student_email: string; // "" for the student's own view
  is_guest: boolean;
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
];

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return (ACTIVE_ORDER_STATUSES as OrderStatus[]).includes(status);
}
