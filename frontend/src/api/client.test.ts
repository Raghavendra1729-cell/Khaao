import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';

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
