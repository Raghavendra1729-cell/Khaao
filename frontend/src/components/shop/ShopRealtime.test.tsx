import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopRealtime } from './ShopRealtime';
import { LanguageProvider } from '../../context/LanguageContext';

vi.mock('../../lib/sound', () => ({
  playIncomingAlert: vi.fn(),
  playOrderComplete: vi.fn(),
}));
vi.mock('../../lib/shopNotifications', () => ({
  pingShopNotification: vi.fn(),
}));
vi.mock('../../lib/liveAnnouncer', () => ({
  announce: vi.fn(),
}));

const getShopOrdersMock = vi.fn();
vi.mock('../../api/shop', () => ({
  getShopOrders: () => getShopOrdersMock(),
}));

let capturedOnOpen: (() => void) | null = null;
vi.mock('../../hooks/useSSE', () => ({
  useSSE: (_path: string | null, _onMessage: unknown, onOpen?: () => void) => {
    capturedOnOpen = onOpen ?? null;
  },
}));

function renderShopRealtime(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <ShopRealtime />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  capturedOnOpen = null;
  getShopOrdersMock.mockResolvedValue({ incoming: [], in_progress: [], awaiting_payment: [] });
});

// Guards the T5 fix: handleMessage's orders_update branch is the only thing
// that ever refreshes ['shop','history'] — so it was also the one query the
// "onOpen resyncs everything" reconnect self-heal didn't cover. A dropped
// SSE stream mid-rush (backend restart, an elevator) would leave the
// History tab's totals stale until some later, unrelated order completed.
describe('ShopRealtime reconnect resync (STATUS.md § 9.5 T5)', () => {
  it('invalidates shop history on reconnect, alongside orders/prep/menu/status', () => {
    const queryClient = renderShopRealtime();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    capturedOnOpen!();

    const invalidatedKeys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(['shop', 'history']);
    expect(invalidatedKeys).toContainEqual(['shop', 'orders']);
    expect(invalidatedKeys).toContainEqual(['shop', 'prep']);
    expect(invalidatedKeys).toContainEqual(['shop', 'menu']);
    expect(invalidatedKeys).toContainEqual(['shop-status']);
  });
});
