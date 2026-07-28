import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const createOrderMock = vi.fn();
vi.mock('../../api/orders', () => ({
  getActiveOrder: () => Promise.resolve(null),
  createOrder: (...args: unknown[]) => createOrderMock(...args),
}));

vi.mock('../../api/shop', () => ({
  getShopStatus: () => Promise.resolve({ state: 'open', reopen_at: null }),
}));

const requestNotificationPermissionAndSubscribeMock = vi.fn();
vi.mock('../../lib/push', () => ({
  requestNotificationPermissionAndSubscribe: () => requestNotificationPermissionAndSubscribeMock(),
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

// Guards STATUS.md § 9.11-X2: the F10 timing (ask for notification
// permission only after the order exists) was right, but the result of
// `Notification.requestPermission()` was thrown away — a student who taps
// Allow got the OS permission granted with no push subscription ever posted
// to the server, silently killing the product's only screen-off signal on
// the happy path.
describe('Placing an order subscribes to push when permission is freshly granted (STATUS.md § 9.11-X2)', () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    requestNotificationPermissionAndSubscribeMock.mockReset();
  });

  async function placeOrder(queryClient: QueryClient) {
    getMenuMock.mockResolvedValue([menuItem()]);
    createOrderMock.mockResolvedValue(undefined);
    renderMenu(queryClient);

    await waitFor(() => expect(screen.getAllByText('Chai').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByLabelText('Increase quantity')[0]);
    fireEvent.click(await screen.findByText('View cart'));
    fireEvent.click(await screen.findByText('Place order'));
    await waitFor(() => expect(createOrderMock).toHaveBeenCalled());
  }

  it('calls the shared subscribe flow when permission is default', async () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await placeOrder(queryClient);

    await waitFor(() => expect(requestNotificationPermissionAndSubscribeMock).toHaveBeenCalledTimes(1));
  });

  it('does not re-prompt when permission is already granted', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await placeOrder(queryClient);

    expect(requestNotificationPermissionAndSubscribeMock).not.toHaveBeenCalled();
  });

  it('does not re-prompt when permission is denied', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await placeOrder(queryClient);

    expect(requestNotificationPermissionAndSubscribeMock).not.toHaveBeenCalled();
  });
});

// Guards STATUS.md § 9.9-Y4: the menu row collapses its qty stepper down to
// a single "Add" control until the item actually has a qty, returning
// ~84px of a 375px-wide row to the name/price "menu board" line. Uses the
// search codepath (isSearching) so TrendingRail/FavoritesRail — untouched
// by this change and still rendering a full QtyStepper straight away — are
// hidden and don't add a second "Add"/"Increase quantity" control for the
// same item into the query results.
describe('Menu row — Add control collapses the stepper until qty > 0 (STATUS.md § 9.9-Y4)', () => {
  // The cart persists to localStorage (Menu.tsx: survives a backgrounded
  // PWA) — clear it so one test's qty=1 doesn't leak into the next test's
  // fresh render within this file.
  beforeEach(() => {
    localStorage.clear();
  });

  async function renderSearchedItem(queryClient: QueryClient, overrides: Partial<MenuItem> = {}) {
    getMenuMock.mockResolvedValue([menuItem({ name: 'Chai', ...overrides })]);
    renderMenu(queryClient);

    await waitFor(() => expect(screen.getAllByText('Chai').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Search the menu'), { target: { value: 'Chai' } });
    await waitFor(() => expect(screen.getByText('Results (1)')).toBeInTheDocument());
  }

  // Menu.tsx keeps the full category view mounted (merely CSS-hidden) while
  // searching, so a matched item renders twice: once in the visible search
  // results, once in the hidden category list underneath (both driven by
  // the same cart state). Assertions use getAllByLabelText/queryByLabelText
  // rather than assuming a single match for that reason.
  it('renders an Add control and no stepper for an item at qty 0', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderSearchedItem(queryClient);

    expect(screen.getAllByLabelText('Add Chai').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Increase quantity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Decrease quantity')).not.toBeInTheDocument();
  });

  it('tapping Add sets qty to 1 and swaps in the full stepper', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderSearchedItem(queryClient);

    fireEvent.click(screen.getAllByLabelText('Add Chai')[0]);

    await waitFor(() => expect(screen.getAllByLabelText('Decrease quantity').length).toBeGreaterThan(0));
    expect(screen.getAllByLabelText('Increase quantity').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Add Chai')).not.toBeInTheDocument();
  });

  it('decrementing back to 0 returns to the Add control', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderSearchedItem(queryClient);

    fireEvent.click(screen.getAllByLabelText('Add Chai')[0]);
    await waitFor(() => expect(screen.getAllByLabelText('Decrease quantity').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByLabelText('Decrease quantity')[0]);

    await waitFor(() => expect(screen.getAllByLabelText('Add Chai').length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('Decrease quantity')).not.toBeInTheDocument();
  });

  it('an unorderable item offers neither an enabled Add nor an enabled increment', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderSearchedItem(queryClient, { orderable: false, status: 'out_of_stock' });

    expect(screen.queryByLabelText('Add Chai')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Increase quantity')).not.toBeInTheDocument();
  });
});
