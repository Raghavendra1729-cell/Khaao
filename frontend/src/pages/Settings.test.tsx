import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SettingsPage } from './Settings';
import { Layout } from '../components/layout/Layout';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../components/ui/Toast';
import { setAuthStorage } from '../api/client';
import type { User } from '../api/types';

vi.mock('../api/orders', () => ({
  getActiveOrder: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/shop', () => ({
  getPrep: vi.fn().mockResolvedValue([]),
  getShopOrders: vi.fn().mockResolvedValue({ incoming: [], preparing: [], ready: [] }),
  getVapidPublicKey: vi.fn().mockResolvedValue({ public_key: 'AAAA' }),
  subscribeToPush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../components/student/StudentRealtime', () => ({
  StudentRealtime: () => <div data-testid="student-realtime" />,
}));
vi.mock('../components/shop/ShopRealtime', () => ({
  ShopRealtime: () => <div data-testid="shop-realtime-marker" />,
}));
vi.mock('../components/shop/ShopStatusControl', () => ({
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

function renderAt(user: User, initialPath: string) {
  setAuthStorage('tok', user);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<div data-testid="page" />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings route (STATUS.md § 9.7 P1)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders for a student', async () => {
    renderAt(student, '/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
    expect(screen.getByText('Get the app')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('About Khaao')).toBeInTheDocument();
  });

  it('renders for a shopkeeper', async () => {
    renderAt(shopkeeper, '/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
  });

  it("the student render contains no Hindi text, even if a shopkeeper's language preference leaked into localStorage", async () => {
    // Simulate a shared-device leak: LanguageContext reads this same key
    // regardless of who's currently signed in.
    localStorage.setItem('khaao_shop_lang', 'hi');

    renderAt(student, '/settings');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());

    const hindiStrings = ['सेटिंग्स', 'लॉग आउट', 'सूचनाएं', 'खाता', 'ऐप डाउनलोड करें'];
    for (const hindi of hindiStrings) {
      expect(screen.queryByText(hindi)).not.toBeInTheDocument();
    }
  });

  it("AvatarMenu's Settings item navigates to /settings", async () => {
    renderAt(student, '/');
    await waitFor(() => expect(screen.getByTestId('page')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Account menu for Alice' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
  });
});
