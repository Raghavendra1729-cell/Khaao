import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StudentRealtime } from './StudentRealtime';
import * as soundLib from '../lib/sound';
import type { SSEMessage } from '../hooks/useSSE';
import type { Order, OrderItem } from '../api/types';

const showToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../lib/sound', () => ({
  playReadyChime: vi.fn(),
  playStatusChange: vi.fn(),
}));

let capturedOnMessage: ((msg: SSEMessage) => void) | null = null;
let capturedOnOpen: (() => void) | null = null;
vi.mock('../hooks/useSSE', () => ({
  useSSE: (_path: string | null, onMessage: (msg: SSEMessage) => void, onOpen?: () => void) => {
    capturedOnMessage = onMessage;
    capturedOnOpen = onOpen ?? null;
  },
}));

function orderItem(overrides: Partial<OrderItem> & { id: number }): OrderItem {
  return {
    menu_item_id: overrides.id,
    name: `Item ${overrides.id}`,
    photo_url: null,
    qty: 1,
    allocated_qty: 0,
    handed_qty: 0,
    status: 'pending',
    price_each: 100,
    ...overrides,
  };
}

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: 42,
    order_date: '2026-07-18',
    status: 'submitted',
    total_price: 1000,
    paid: false,
    paid_at: null,
    created_at: new Date().toISOString(),
    ready_at: null,
    expires_at: null,
    student_name: '',
    student_email: '',
    items: [],
    ...overrides,
  };
}

function renderStudentRealtime(initialPath = '/'): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <StudentRealtime />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  capturedOnMessage = null;
  capturedOnOpen = null;
  showToast.mockClear();
  vi.mocked(soundLib.playReadyChime).mockClear();
  vi.mocked(soundLib.playStatusChange).mockClear();
});

describe('StudentRealtime — transition to notification decisions', () => {
  it('plays the ready chime and shows a toast when the order transitions to ready, away from /order', () => {
    renderStudentRealtime('/'); // browsing the menu, not the order-status page
    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'preparing' }) });
    showToast.mockClear();

    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'ready' }) });

    expect(soundLib.playReadyChime).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('is ready'), 'success');
  });

  it('suppresses the redundant ready toast when the student is already on the order-status page', () => {
    renderStudentRealtime('/order');
    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'preparing' }) });
    showToast.mockClear();

    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'ready' }) });

    expect(soundLib.playReadyChime).toHaveBeenCalledTimes(1); // still chimes/vibrates
    expect(showToast).not.toHaveBeenCalled(); // but no redundant toast — they're already looking at it
  });

  it('does not re-fire a notification when the same status is reported again (duplicate SSE delivery)', () => {
    renderStudentRealtime('/');
    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'ready' }) });
    vi.mocked(soundLib.playReadyChime).mockClear();
    showToast.mockClear();

    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'ready' }) });

    expect(soundLib.playReadyChime).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows a trim toast (not the generic status-change toast) when items are newly rejected mid-order', () => {
    renderStudentRealtime('/');
    capturedOnMessage!({
      type: 'order_update',
      order: baseOrder({ status: 'preparing', items: [orderItem({ id: 1, status: 'pending' })] }),
    });
    showToast.mockClear();

    capturedOnMessage!({
      type: 'order_update',
      order: baseOrder({ status: 'preparing', items: [orderItem({ id: 1, status: 'rejected' })] }),
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('removed from your order'), 'info');
  });

  it('shows the "declined by canteen" toast — not the trim wording — when the whole order is rejected', () => {
    renderStudentRealtime('/');
    capturedOnMessage!({
      type: 'order_update',
      order: baseOrder({ status: 'submitted', items: [orderItem({ id: 1, status: 'pending' })] }),
    });
    showToast.mockClear();

    capturedOnMessage!({
      type: 'order_update',
      order: baseOrder({ status: 'rejected', items: [orderItem({ id: 1, status: 'rejected' })] }),
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('declined by the canteen'), 'error');
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('removed from your order'),
      expect.anything(),
    );
  });

  it('shows the awaiting-payment toast on the preparing -> awaiting_payment transition', () => {
    renderStudentRealtime('/');
    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'preparing' }) });
    showToast.mockClear();

    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'awaiting_payment' }) });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Please pay at the counter'), 'success');
  });

  it('does not toast on the very first message for a terminal status other than rejected/expired', () => {
    // prevStatus starts null (no prior active order) — a first-ever
    // "completed" delivery (e.g. page loaded after order finished) should
    // not announce a transition that was never observed happening.
    renderStudentRealtime('/');
    capturedOnMessage!({ type: 'order_update', order: baseOrder({ status: 'completed' }) });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('invalidates the menu, orders, and shop-status queries on every reconnect (onOpen)', () => {
    const queryClient = renderStudentRealtime('/');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    capturedOnOpen!();

    const invalidatedKeys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toEqual(expect.arrayContaining(['orders', 'menu', 'shop-status']));
  });
});
