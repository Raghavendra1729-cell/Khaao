import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Menu } from './Menu';
import { ToastProvider } from '../../components/ui/Toast';
import type { MenuItem } from '../../api/types';

// jsdom has no IntersectionObserver; Menu.tsx uses one for category scroll-spy.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

const getMenuMock = vi.fn();
vi.mock('../../api/menu', () => ({
  getMenu: () => getMenuMock(),
}));

vi.mock('../../api/orders', () => ({
  getActiveOrder: () => Promise.resolve(null),
  createOrder: vi.fn(),
}));

vi.mock('../../api/shop', () => ({
  getShopStatus: () => Promise.resolve({ state: 'open', reopen_at: null }),
}));

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 1,
    name: 'Chai',
    price: 1500,
    photo_url: null,
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

function renderMenu(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <Menu />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Menu — isError does not hide cached data (R25)', () => {
  it('keeps rendering the menu after a failed background refetch instead of showing an error state', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    getMenuMock.mockResolvedValueOnce([menuItem()]);
    renderMenu(queryClient);

    // A single item shows both in "Today's menu" and in the trending rail's
    // newest-items fallback, so there are two "Chai" nodes — assert on
    // presence via getAllByText, not the exact-one getByText.
    await waitFor(() => expect(screen.getAllByText('Chai').length).toBeGreaterThan(0));

    // Simulate a background refetch (e.g. a flaky network reconnect) that
    // fails while the last good response is still cached.
    getMenuMock.mockRejectedValueOnce(new Error('network error'));
    await queryClient.refetchQueries({ queryKey: ['menu'] });

    await waitFor(() => {
      const menuQueryState = queryClient.getQueryState(['menu']);
      expect(menuQueryState?.status).toBe('error');
    });

    // The cached menu item must still be on screen, and the error state
    // must not have replaced it.
    expect(screen.getAllByText('Chai').length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn't load the menu")).not.toBeInTheDocument();
  });

  it('shows the error state when there is no cached data to fall back on', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    getMenuMock.mockRejectedValueOnce(new Error('network error'));
    renderMenu(queryClient);

    await waitFor(() => expect(screen.getByText("Couldn't load the menu")).toBeInTheDocument());
  });
});
