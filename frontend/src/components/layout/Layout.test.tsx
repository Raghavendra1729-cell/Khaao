import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../ui/Toast';
import { setAuthStorage } from '../../api/client';
import type { User } from '../../api/types';

vi.mock('../../api/orders', () => ({
  getActiveOrder: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../api/shop', () => ({
  getPrep: vi.fn().mockResolvedValue([]),
  getShopOrders: vi.fn().mockResolvedValue({ incoming: [], preparing: [], ready: [] }),
}));
vi.mock('../student/StudentRealtime', () => ({
  StudentRealtime: () => <div data-testid="student-realtime" />,
}));

// These two are the ones Layout.tsx lazy()-splits out of the shared chunk
// (STATUS.md § 9.4 H2) — the mock renders a marker so the test can assert
// they never mount on the student render path, whether the Suspense
// boundary has resolved yet or not.
vi.mock('../shop/ShopRealtime', () => ({
  ShopRealtime: () => <div data-testid="shop-realtime-marker" />,
}));
vi.mock('../shop/ShopStatusControl', () => ({
  ShopStatusControl: () => <div data-testid="shop-status-control-marker" />,
}));

const student: User = { id: 1, name: 'Alice', email: 'alice@sst.scaler.com', role: 'student', photo_url: '' };
const shopkeeper: User = {
  id: 2,
  name: 'Bob',
  email: 'bob@sst.scaler.com',
  role: 'shopkeeper',
  photo_url: '',
};

function renderLayout(user: User) {
  setAuthStorage('tok', user);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<div data-testid="page" />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Layout code-splits shop-only components off the student bundle (STATUS.md § 9.4 H2)', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom doesn't implement matchMedia — InstallPrompt (always mounted by
    // Layout, for both roles) reads it synchronously on first render.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('never mounts ShopRealtime or ShopStatusControl for a student', async () => {
    renderLayout(student);

    // Let any pending queries/effects/microtasks settle.
    await waitFor(() => expect(screen.getByTestId('student-realtime')).toBeInTheDocument());

    expect(screen.queryByTestId('shop-realtime-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shop-status-control-marker')).not.toBeInTheDocument();
  });

  it('does mount ShopRealtime and ShopStatusControl (behind Suspense) for a shopkeeper', async () => {
    renderLayout(shopkeeper);

    // These are lazy-loaded, so they only appear once the dynamic import
    // (here, the mocked module) resolves — confirms the boundary actually
    // renders the real components for the role that needs them.
    await waitFor(() => expect(screen.getByTestId('shop-realtime-marker')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('shop-status-control-marker')).toBeInTheDocument());
  });
});
