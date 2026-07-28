import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopHistoryPage } from './History';
import { LanguageProvider } from '../../context/LanguageContext';

const getShopHistoryMock = vi.fn();

vi.mock('../../api/shop', () => ({
  getShopHistory: (...args: unknown[]) => getShopHistoryMock(...args),
}));

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LanguageProvider>
          <ShopHistoryPage />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Guards STATUS.md § 9.12-Y14: the loading skeleton is `aria-hidden` (correct
// — it's decorative bones, not real content) but announced nothing at all in
// its place, leaving a screen-reader user in silence between navigating to
// History and the real data landing.
describe('ShopHistoryPage loading state announces a status (STATUS.md § 9.12-Y14)', () => {
  beforeEach(() => {
    getShopHistoryMock.mockReset();
  });

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
