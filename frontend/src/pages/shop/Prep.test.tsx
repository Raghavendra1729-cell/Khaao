import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ShopPrepPage } from './Prep';
import { ToastProvider } from '../../components/ui/Toast';
import { LanguageProvider } from '../../context/LanguageContext';

const getPrepMock = vi.fn();

vi.mock('../../api/shop', () => ({
  getPrep: () => getPrepMock(),
  markPrepDone: vi.fn(),
}));

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LanguageProvider>
          <ToastProvider>
            <ShopPrepPage />
          </ToastProvider>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Guards STATUS.md § 9.12-Y14: the prep-list loading skeleton renders as
// decorative bones with nothing announced in its place — a shopkeeper's
// screen reader stays silent between opening the Prep tab and the list
// actually arriving.
describe('ShopPrepPage loading state announces a status (STATUS.md § 9.12-Y14)', () => {
  beforeEach(() => {
    getPrepMock.mockReset();
  });

  it('exposes a status message while loading, and clears it once data lands', async () => {
    let resolvePrep: (value: unknown) => void = () => {};
    getPrepMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePrep = resolve;
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(queryClient);

    expect(screen.getByRole('status')).toBeInTheDocument();

    resolvePrep([]);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
