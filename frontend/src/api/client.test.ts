import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, clearAuthStorage } from './client';

// Guards the R31 fix: a hung request (mobile radio drops mid-request, no
// RST ever arrives) must not leave callers waiting forever — apiFetch must
// pass an AbortSignal so fetch itself enforces a ceiling.
describe('apiFetch timeout (R31)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('passes an AbortSignal to fetch so a hung request is not waited on forever', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiFetch('/menu');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces a timeout as the same ApiError(0, ...) network-error path as any other failed fetch', async () => {
    const abortError = new DOMException('signal timed out', 'TimeoutError');
    global.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch;

    await expect(apiFetch('/menu')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    });
  });
});

// Guards the T2 fix: on a shared device, logging out must not leave the
// previous student's cart/favorites/rating-state behind for whoever signs
// in next — but device-scoped keys (install prompt dismissal, shop-only UI
// language) are not part of any account's session and must survive.
describe('clearAuthStorage (STATUS.md § 9.5 T2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears session/student-scoped keys but leaves device-scoped keys alone', () => {
    localStorage.setItem('khaao_token', 'tok');
    localStorage.setItem('khaao_user', '{"id":1}');
    localStorage.setItem('khaao_cart_v2', '{"1":2}');
    localStorage.setItem('khaao_favorites_v1', '[1,2]');
    localStorage.setItem('khaao_rated_orders', '[3]');
    localStorage.setItem('khaao_install_dismissed', '1');
    localStorage.setItem('khaao_shop_lang', 'hi');

    clearAuthStorage();

    expect(localStorage.getItem('khaao_token')).toBeNull();
    expect(localStorage.getItem('khaao_user')).toBeNull();
    expect(localStorage.getItem('khaao_cart_v2')).toBeNull();
    expect(localStorage.getItem('khaao_favorites_v1')).toBeNull();
    expect(localStorage.getItem('khaao_rated_orders')).toBeNull();
    expect(localStorage.getItem('khaao_install_dismissed')).toBe('1');
    expect(localStorage.getItem('khaao_shop_lang')).toBe('hi');
  });
});
