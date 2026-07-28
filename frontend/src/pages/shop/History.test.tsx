import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopHistoryPage } from './History';
import { LanguageProvider } from '../../context/LanguageContext';
import type { Order } from '../../api/types';
import type { ShopHistory } from '../../api/shop';

const getShopHistoryMock = vi.fn();

vi.mock('../../api/shop', () => ({
  getShopHistory: (...args: unknown[]) => getShopHistoryMock(...args),
}));

/** Today, at a given local hour/minute — round-trips through the same local
 * Date object the component itself uses to bucket timestamps, so the test
 * is independent of whatever timezone the machine running it happens to be
 * in (matching History.tsx's own todayLocal()/shiftDate() reasoning). */
function isoAtLocalTime(hour: number, minute: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).toISOString();
}

let nextId = 1;
function makeOrder(overrides: Partial<Order> = {}): Order {
  const id = nextId++;
  return {
    id,
    order_no: id,
    order_date: '2026-07-28',
    status: 'completed',
    total_price: 2000,
    paid: true,
    paid_at: isoAtLocalTime(12, 15),
    created_at: isoAtLocalTime(12, 15),
    ready_at: null,
    expires_at: null,
    student_name: 'Student',
    student_email: '',
    items: [
      {
        id: id * 10,
        menu_item_id: 1,
        name: 'Samosa',
        photo_url: null,
        qty: 1,
        allocated_qty: 1,
        handed_qty: 1,
        status: 'handed_over',
        price_each: 2000,
      },
    ],
    ...overrides,
  };
}

function renderPage(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider>
          <ShopHistoryPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getShopHistoryMock.mockReset();
  nextId = 1;
});

// Guards STATUS.md § 9.12 Y5: the History page used to stop at "how much did
// I collect today" — it now derives the day's shape (when orders landed,
// per half-hour) client-side from `orders[].created_at`/`paid_at`, entirely
// from data the page already fetches.
describe('Day shape — half-hour order buckets (STATUS.md § 9.12 Y5)', () => {
  it('buckets orders into the right half-hour columns and finds the busiest one', async () => {
    const orders: Order[] = [
      ...Array.from({ length: 3 }, () =>
        makeOrder({ created_at: isoAtLocalTime(12, 10), paid_at: isoAtLocalTime(12, 10) }),
      ),
      makeOrder({ created_at: isoAtLocalTime(12, 40), paid_at: isoAtLocalTime(12, 40) }),
      ...Array.from({ length: 5 }, () =>
        makeOrder({ created_at: isoAtLocalTime(13, 5), paid_at: isoAtLocalTime(13, 5), total_price: 3000 }),
      ),
    ];
    const history: ShopHistory = {
      orders,
      total_paid: orders.reduce((sum, o) => sum + o.total_price, 0),
      insights: {
        order_count: orders.length,
        item_counts: [{ name: 'Samosa', qty: orders.length }],
        customers: [],
      },
    };
    getShopHistoryMock.mockResolvedValue(history);

    renderPage();

    await screen.findByText('Day shape');
    // The 12:00-12:30 bucket (3 orders) and the 12:30-1:00 bucket (1 order)
    // each render their own count.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // The busiest half-hour (5 orders, 1-1:30pm) is named with its own
    // correct count and revenue — proof the bucketing lines up orders with
    // the right half-hour rather than dumping them in one pile. Whole-rupee
    // revenue (₹150) renders without a trailing ".00" per § 9.12-Y16.
    expect(screen.getByText(/Busiest around 1p.*5 orders.*₹150\b/)).toBeInTheDocument();
  });

  it('renders the existing empty state and no day-shape chart for an empty day', async () => {
    getShopHistoryMock.mockResolvedValue({
      orders: [],
      total_paid: 0,
      insights: { order_count: 0, item_counts: [], customers: [] },
    });

    renderPage();

    await screen.findByText('No orders found');
    expect(screen.queryByText('Day shape')).not.toBeInTheDocument();
  });
});

// Guards STATUS.md § 9.12 Y5: revenue per item (qty × price_each, summed) is
// a different ranking than the backend's qty-only item_counts — the item
// that sells the most units is often not the one that earns the most.
describe('Revenue per item differs from qty ranking (STATUS.md § 9.12 Y5)', () => {
  it('ranks a low-volume, high-price item above a high-volume, low-price one', async () => {
    const order = makeOrder({
      total_price: 17000,
      items: [
        {
          id: 1,
          menu_item_id: 1,
          name: 'Chai',
          photo_url: null,
          qty: 10,
          allocated_qty: 10,
          handed_qty: 10,
          status: 'handed_over',
          price_each: 500, // ₹5 each × 10 = ₹50 revenue
        },
        {
          id: 2,
          menu_item_id: 2,
          name: 'Thali',
          photo_url: null,
          qty: 2,
          allocated_qty: 2,
          handed_qty: 2,
          status: 'handed_over',
          price_each: 6000, // ₹60 each × 2 = ₹120 revenue
        },
      ],
    });
    const history: ShopHistory = {
      orders: [order],
      total_paid: 17000,
      insights: {
        order_count: 1,
        item_counts: [
          { name: 'Chai', qty: 10 },
          { name: 'Thali', qty: 2 },
        ],
        customers: [],
      },
    };
    getShopHistoryMock.mockResolvedValue(history);

    renderPage();

    const topItemsCard = (await screen.findByText('Top items')).parentElement as HTMLElement;
    const topItemsOrder = within(topItemsCard)
      .getAllByText(/^(Chai|Thali)$/)
      .map((el) => el.textContent);
    expect(topItemsOrder).toEqual(['Chai', 'Thali']); // backend's qty order, unchanged

    const topEarnersCard = screen.getByText('Top earners').parentElement as HTMLElement;
    const topEarnersOrder = within(topEarnersCard)
      .getAllByText(/^(Chai|Thali)$/)
      .map((el) => el.textContent);
    expect(topEarnersOrder).toEqual(['Thali', 'Chai']); // revenue order — reversed

    // Whole-rupee amounts render without a trailing ".00" per § 9.12-Y16.
    expect(within(topEarnersCard).getByText('₹120')).toBeInTheDocument();
    expect(within(topEarnersCard).getByText('₹50')).toBeInTheDocument();
  });
});

// Guards STATUS.md § 9.12 Y13: `maxQty` was `Math.max(...qtys)` with no
// floor, so an all-zero day divided 0/0 into the bar's inline width and
// produced an invalid "NaN%" that the browser silently drops (verified
// against real jsdom: an invalid inline style value leaves style.width as
// "", not the literal string "NaN%").
describe('Top items bar never emits a NaN width (STATUS.md § 9.12 Y13)', () => {
  it('renders a valid width when every item_counts qty is 0', async () => {
    const order = makeOrder();
    const history: ShopHistory = {
      orders: [order],
      total_paid: 0,
      insights: {
        order_count: 1,
        item_counts: [
          { name: 'Chai', qty: 0 },
          { name: 'Thali', qty: 0 },
        ],
        customers: [],
      },
    };
    getShopHistoryMock.mockResolvedValue(history);

    renderPage();

    const topItemsCard = (await screen.findByText('Top items')).parentElement as HTMLElement;
    const bars = topItemsCard.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div[style]');
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => {
      expect(bar.style.width).toMatch(/^\d+(\.\d+)?%$/);
    });
  });
});

// Guards STATUS.md § 9.12-Y14: the loading skeleton is `aria-hidden` (correct
// — it's decorative bones, not real content) but announced nothing at all in
// its place, leaving a screen-reader user in silence between navigating to
// History and the real data landing.
describe('ShopHistoryPage loading state announces a status (STATUS.md § 9.12-Y14)', () => {
  it('exposes a status message while loading, and clears it once data lands', async () => {
    let resolveHistory: (value: unknown) => void = () => {};
    getShopHistoryMock.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    expect(screen.getByRole('status')).toBeInTheDocument();

    resolveHistory({
      orders: [],
      total_paid: 0,
      insights: { order_count: 0, item_counts: [], customers: [] },
    });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
