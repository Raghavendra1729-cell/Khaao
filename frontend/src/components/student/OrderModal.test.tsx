import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrderModal } from './OrderModal';
import { ToastProvider } from '../ui/Toast';
import { LanguageProvider } from '../../context/LanguageContext';
import { AuthProvider } from '../../context/AuthContext';
import type { Order } from '../../api/types';

const handoverItemMock = vi.fn();
const markPaidMock = vi.fn();
const removeOrderItemMock = vi.fn();
const rejectOrderMock = vi.fn();
const setMenuItemStockMock = vi.fn();

vi.mock('../../api/shop', () => ({
  handoverItem: (...args: unknown[]) => handoverItemMock(...args),
  markPaid: (...args: unknown[]) => markPaidMock(...args),
  removeOrderItem: (...args: unknown[]) => removeOrderItemMock(...args),
  rejectOrder: (...args: unknown[]) => rejectOrderMock(...args),
  setMenuItemStock: (...args: unknown[]) => setMenuItemStockMock(...args),
}));

function baseOrder(): Order {
  return {
    id: 1,
    order_no: 7,
    order_date: '2026-07-25',
    status: 'preparing',
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
        allocated_qty: 1,
        handed_qty: 0,
        status: 'queued',
        price_each: 1000,
      },
    ],
  };
}

function renderModal(queryClient: QueryClient, order: Order) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LanguageProvider>
          <MemoryRouter>
            <AuthProvider>
              <OrderModal order={order} onClose={() => {}} />
            </AuthProvider>
          </MemoryRouter>
        </LanguageProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Guards STATUS.md § 9.6-U2: removeMutation used to flag the item out of
// stock *before* calling removeOrderItem, with no rollback if the removal
// itself then failed — leaving the item out of stock with nothing removed
// to justify it.
describe('OrderModal remove-item does not flag stock when the removal itself fails (STATUS.md § 9.6 U2)', () => {
  beforeEach(() => {
    handoverItemMock.mockReset();
    markPaidMock.mockReset();
    removeOrderItemMock.mockReset();
    rejectOrderMock.mockReset();
    setMenuItemStockMock.mockReset();
  });

  it('does not mark the item out of stock when removeOrderItem itself fails', async () => {
    const order = baseOrder();
    setMenuItemStockMock.mockResolvedValue(undefined);
    removeOrderItemMock.mockRejectedValue(new Error('409 already handed'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderModal(queryClient, order);

    fireEvent.click(screen.getByText('Remove item'));
    const stockCheckbox = await screen.findByText('Also mark out of stock');

    fireEvent.click(stockCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeOrderItemMock).toHaveBeenCalledWith(1, 1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    expect(setMenuItemStockMock).not.toHaveBeenCalled();
  });
});
