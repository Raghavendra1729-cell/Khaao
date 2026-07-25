import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrderStatusPage } from './OrderStatus';
import { ToastProvider } from '../../components/ui/Toast';
import type { Order } from '../../api/types';

const getActiveOrderMock = vi.fn();
const getOrderHistoryMock = vi.fn();
const cancelOrderMock = vi.fn();
const submitRatingsMock = vi.fn();
const getMenuMock = vi.fn();

vi.mock('../../api/orders', () => ({
  getActiveOrder: () => getActiveOrderMock(),
  getOrderHistory: () => getOrderHistoryMock(),
  cancelOrder: (...args: unknown[]) => cancelOrderMock(...args),
  submitRatings: (...args: unknown[]) => submitRatingsMock(...args),
}));

vi.mock('../../api/menu', () => ({
  getMenu: () => getMenuMock(),
}));

function completedOrder(): Order {
  return {
    id: 1,
    order_no: 7,
    order_date: '2026-07-25',
    status: 'completed',
    total_price: 2000,
    paid: true,
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ready_at: null,
    expires_at: null,
    student_name: '',
    student_email: '',
    items: [
      {
        id: 1,
        menu_item_id: 10,
        name: 'Samosa',
        photo_url: null,
        qty: 2,
        allocated_qty: 2,
        handed_qty: 2,
        status: 'handed_over',
        price_each: 1000,
      },
    ],
  };
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <OrderStatusPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Guards STATUS.md § 9.6-U4: reorderIntoCart's own `!menuItems` branch is
// correctly conservative (it can't know if past items are still on the
// menu), but the page used to render that as the confident claim "None of
// these items are on today's menu" even when the menu query had simply
// failed or not finished loading yet — the same class of bug § 9.1.7 / R3
// already bans everywhere else in this app (never present a network
// failure as a data conclusion).
describe("'Order this again' does not blame the menu when the menu query itself failed (STATUS.md § 9.6 U4)", () => {
  beforeEach(() => {
    getActiveOrderMock.mockReset();
    getOrderHistoryMock.mockReset();
    cancelOrderMock.mockReset();
    submitRatingsMock.mockReset();
    getMenuMock.mockReset();
  });

  it('disables the reorder button and shows an honest hint instead of claiming items are off the menu', async () => {
    getActiveOrderMock.mockResolvedValue(null);
    getOrderHistoryMock.mockResolvedValue([completedOrder()]);
    getMenuMock.mockRejectedValue(new Error('network error'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    const reorderButton = await screen.findByText('Order this again');
    await waitFor(() => expect(reorderButton.closest('button')).toBeDisabled());

    expect(screen.getByText("Couldn't check today's menu — try again shortly.")).toBeInTheDocument();
    expect(screen.queryByText(/None of these items are on today's menu/)).not.toBeInTheDocument();

    // A disabled native button ignores clicks — assert no false toast fires
    // even if something upstream tried.
    reorderButton.closest('button')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// Guards the fold-in half of STATUS.md § 9.6-U4: the hold window is
// HOLD_MINUTES, a real config knob (default 15, but tunable) — hardcoding
// "15-minute" in this copy would silently start lying the moment a canteen
// operator tunes it after go-live.
describe('History status hint does not hardcode the configurable hold window', () => {
  beforeEach(() => {
    getActiveOrderMock.mockReset();
    getOrderHistoryMock.mockReset();
    cancelOrderMock.mockReset();
    submitRatingsMock.mockReset();
    getMenuMock.mockReset();
  });

  it('describes an expired order without naming a specific number of minutes', async () => {
    getActiveOrderMock.mockResolvedValue(null);
    getOrderHistoryMock.mockResolvedValue([
      { ...completedOrder(), status: 'expired', paid: false, paid_at: null },
    ]);
    getMenuMock.mockResolvedValue([]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await screen.findByText(/pickup window was missed/);
    expect(screen.queryByText(/15-minute/)).not.toBeInTheDocument();
  });
});
