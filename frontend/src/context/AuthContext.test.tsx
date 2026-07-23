import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { setAuthStorage } from '../api/client';
import type { User } from '../api/types';

const student: User = { id: 1, name: 'Alice', email: 'alice@sst.scaler.com', role: 'student', photo_url: '' };

function TestConsumer() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={logout}>
      logout
    </button>
  );
}

function renderAuth(queryClient: QueryClient) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Guards the T2 fix: on a shared device, neither exit from a session
// (explicit logout, or the khaao:unauthorized handler firing on a 401) may
// leave the previous student's React Query cache resident — order history,
// active order, and menu queries would otherwise render immediately for
// whoever signs in next, before any fresh fetch has a chance to replace them.
describe('AuthContext session teardown clears the query cache (STATUS.md § 9.5 T2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('logout() clears the React Query cache', () => {
    setAuthStorage('tok', student);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['orders', 'history'], [{ id: 1 }]);

    renderAuth(queryClient);
    fireEvent.click(screen.getByText('logout'));

    expect(queryClient.getQueryData(['orders', 'history'])).toBeUndefined();
  });

  it('the khaao:unauthorized handler also clears the React Query cache', () => {
    setAuthStorage('tok', student);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['orders', 'history'], [{ id: 1 }]);

    renderAuth(queryClient);
    act(() => {
      window.dispatchEvent(new Event('khaao:unauthorized'));
    });

    expect(queryClient.getQueryData(['orders', 'history'])).toBeUndefined();
  });
});
