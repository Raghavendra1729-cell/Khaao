import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopOrdersPage } from './Orders';
import { ToastProvider } from '../../components/ui/Toast';
import { LanguageProvider } from '../../context/LanguageContext';
import { AuthProvider } from '../../context/AuthContext';
import { setAuthStorage } from '../../api/client';
import type { Order, User } from '../../api/types';

const shopkeeper: User = {
  id: 2,
  name: 'Bob',
  email: 'bob@sst.scaler.com',
  role: 'shopkeeper',
  photo_url: '',
};

const getShopOrdersMock = vi.fn();
const acceptOrderMock = vi.fn();
const rejectOrderMock = vi.fn();
const setMenuItemStockMock = vi.fn();

vi.mock('../../api/shop', () => ({
  getShopOrders: () => getShopOrdersMock(),
  acceptOrder: (...args: unknown[]) => acceptOrderMock(...args),
  rejectOrder: (...args: unknown[]) => rejectOrderMock(...args),
  setMenuItemStock: (...args: unknown[]) => setMenuItemStockMock(...args),
}));

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: 7,
    order_date: '2026-07-23',
    status: 'submitted',
    total_price: 2000,
    paid: false,
    paid_at: null,
    created_at: new Date().toISOString(),
    ready_at: null,
    expires_at: null,
    student_name: 'Alice',
    student_email: 'alice@sst.scaler.com',
    items: [
      {
        id: 1,
        menu_item_id: 10,
        name: 'Samosa',
        photo_url: null,
        qty: 2,
        allocated_qty: 0,
        handed_qty: 0,
        status: 'pending',
        price_each: 1000,
      },
    ],
    ...overrides,
  };
}

function renderPage(queryClient: QueryClient) {
  setAuthStorage('tok', shopkeeper);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <LanguageProvider>
              <ShopOrdersPage />
            </LanguageProvider>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Guards the T3 fix: Promise.allSettled never rejects, so accepting an
// order while marking its unchecked items out of stock previously reported
// success even when every stock-update call failed (429 rate limit, a
// dropped Wi-Fi packet) — leaving those items orderable on the student menu
// with no visible error anywhere.
describe('Shop Accept surfaces stock-update failures (STATUS.md § 9.5 T3)', () => {
  beforeEach(() => {
    getShopOrdersMock.mockReset();
    acceptOrderMock.mockReset();
    rejectOrderMock.mockReset();
    setMenuItemStockMock.mockReset();
  });

  it('shows an error toast naming the item, without blocking the order accept', async () => {
    const order = baseOrder();
    getShopOrdersMock.mockResolvedValue({ incoming: [order], in_progress: [], awaiting_payment: [] });
    setMenuItemStockMock.mockRejectedValue(new Error('429'));
    acceptOrderMock.mockResolvedValue({ ...order, status: 'preparing' });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText('Samosa ×2')).toBeInTheDocument());

    // Uncheck the item — Accept then tries to mark it out of stock and reject it.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => expect(acceptOrderMock).toHaveBeenCalledWith(1, [1]));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Samosa');
    });
  });
});

// Guards STATUS.md § 9.6-U2: the stock-flag write used to fire *before* the
// primary accept/reject call, with no rollback — so a failed accept/reject
// (a race with another device, a rate limit, dropped Wi-Fi) still left the
// flagged items marked out of stock on the student menu, with no order
// action to justify it.
describe('Shop Accept/Reject do not flag stock when the primary action itself fails (STATUS.md § 9.6 U2)', () => {
  beforeEach(() => {
    getShopOrdersMock.mockReset();
    acceptOrderMock.mockReset();
    rejectOrderMock.mockReset();
    setMenuItemStockMock.mockReset();
  });

  it('does not mark the unchecked item out of stock when accept itself fails', async () => {
    const order = baseOrder();
    getShopOrdersMock.mockResolvedValue({ incoming: [order], in_progress: [], awaiting_payment: [] });
    acceptOrderMock.mockRejectedValue(new Error('409 order already accepted'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText('Samosa ×2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => expect(acceptOrderMock).toHaveBeenCalledWith(1, [1]));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(setMenuItemStockMock).not.toHaveBeenCalled();
  });

  it('does not mark the flagged item out of stock when reject itself fails', async () => {
    const order = baseOrder();
    getShopOrdersMock.mockResolvedValue({ incoming: [order], in_progress: [], awaiting_payment: [] });
    rejectOrderMock.mockRejectedValue(new Error('409 order already accepted'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText('Samosa ×2')).toBeInTheDocument());

    // Open the reject dialog and tick the item as unavailable.
    fireEvent.click(screen.getByText('Reject'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByText('Reject order'));

    await waitFor(() => expect(rejectOrderMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(setMenuItemStockMock).not.toHaveBeenCalled();
  });
});

// Guards STATUS.md § 9.11-X3: the order modal fell back to the last-seen
// order copy once the real order left the query result (paid/rejected/
// removed on another device — Q5's "two devices, one shopkeeper" scenario).
// The fallback kept live-looking Handover/Collect buttons on screen that
// could only 409, with nothing telling the shopkeeper the order was already
// resolved elsewhere.
describe('The order modal does not go stale when the order leaves the list (STATUS.md § 9.11-X3)', () => {
  beforeEach(() => {
    getShopOrdersMock.mockReset();
    acceptOrderMock.mockReset();
    rejectOrderMock.mockReset();
    setMenuItemStockMock.mockReset();
  });

  function inProgressOrder(): Order {
    return baseOrder({
      status: 'preparing',
      items: [
        {
          id: 1,
          menu_item_id: 10,
          name: 'Samosa',
          photo_url: null,
          qty: 2,
          allocated_qty: 2,
          handed_qty: 0,
          status: 'allocated',
          price_each: 1000,
        },
      ],
    });
  }

  it('replaces the Handover control with a terminal notice once the order is gone from the query result', async () => {
    const order = inProgressOrder();
    getShopOrdersMock.mockResolvedValue({ incoming: [], in_progress: [order], awaiting_payment: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    fireEvent.click(await screen.findByText('Tap to manage'));
    await screen.findByText('Handover 1');

    // Simulate an SSE-driven refetch (another device resolved the order)
    // landing while the modal is still open.
    queryClient.setQueryData(['shop', 'orders'], { incoming: [], in_progress: [], awaiting_payment: [] });

    await waitFor(() => expect(screen.queryByText('Handover 1')).not.toBeInTheDocument());
    expect(screen.getByText(/updated on another device/)).toBeInTheDocument();
  });
});
