import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSSE, type SSEMessage } from './useSSE';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';

vi.mock('../api/auth', () => ({
  mintSSETicket: vi.fn(),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

function latestSource(): FakeEventSource {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSSE', () => {
  it('mints a ticket and opens an EventSource with it in the URL', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok123');
    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toBe('/api/stream?ticket=tok123');
  });

  it('retries indefinitely on repeated EventSource errors instead of giving up (R3)', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const unauthorizedHandler = vi.fn();
    window.addEventListener('khaao:unauthorized', unauthorizedHandler);

    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);

    // Far more consecutive failures than the old MAX_RETRIES(8) cap — this
    // must never force a logout, since a flaky connection says nothing
    // about whether the session itself is still valid.
    for (let i = 0; i < 20; i++) {
      latestSource().onerror?.();
      await vi.advanceTimersByTimeAsync(15_000); // past the capped backoff either way
    }

    expect(FakeEventSource.instances.length).toBeGreaterThan(20);
    expect(unauthorizedHandler).not.toHaveBeenCalled();
    window.removeEventListener('khaao:unauthorized', unauthorizedHandler);
  });

  it('caps backoff delay at 15s and never exceeds it', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);

    // Fail repeatedly with only just-under-the-cap advances; connection
    // count must still keep climbing once enough time has passed, proving
    // the delay never grows unbounded past MAX_BACKOFF_MS (15s).
    for (let i = 0; i < 6; i++) {
      latestSource().onerror?.();
    }
    const beforeCount = FakeEventSource.instances.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(FakeEventSource.instances.length).toBeGreaterThan(beforeCount);
  });

  it('jitters the reconnect delay so many clients dropped at once do not all retry on the same schedule (R28)', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const randomSpy = vi.spyOn(Math, 'random');

    // random() = 0 -> multiplier 0.5 -> attempt-0 delay = 1000 * 0.5 = 500ms.
    randomSpy.mockReturnValue(0);
    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    latestSource().onerror?.();

    await vi.advanceTimersByTimeAsync(499);
    expect(FakeEventSource.instances).toHaveLength(1); // not yet — below the jittered delay
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2); // fires right at 500ms

    // random() = 1 -> multiplier 1.5 -> attempt-0 delay = 1000 * 1.5 = 1500ms,
    // a different value for the same nominal attempt — proving the delay is
    // actually a function of Math.random(), not a disguised constant.
    randomSpy.mockReturnValue(1);
    const { unmount } = renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    latestSource().onerror?.();

    const beforeSecond = FakeEventSource.instances.length;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(FakeEventSource.instances.length).toBe(beforeSecond);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances.length).toBe(beforeSecond + 1);

    unmount();
  });

  it('stops reconnecting after a 401 from the ticket mint, without dispatching another unauthorized event itself', async () => {
    vi.mocked(authApi.mintSSETicket).mockRejectedValue(new ApiError(401, 'expired'));
    const unauthorizedHandler = vi.fn();
    window.addEventListener('khaao:unauthorized', unauthorizedHandler);

    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeEventSource.instances).toHaveLength(0); // never got far enough to connect
    const callsAfterFirst = vi.mocked(authApi.mintSSETicket).mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000); // plenty of time for retries, if any were scheduled
    expect(vi.mocked(authApi.mintSSETicket).mock.calls.length).toBe(callsAfterFirst);
    // apiFetch (not this hook) is responsible for the actual logout dispatch
    // on a real 401 — useSSE only needs to stop burning retries on it.
    expect(unauthorizedHandler).not.toHaveBeenCalled();
    window.removeEventListener('khaao:unauthorized', unauthorizedHandler);
  });

  it('retries on a network error minting the ticket (status 0), same as any other failed attempt', async () => {
    vi.mocked(authApi.mintSSETicket)
      .mockRejectedValueOnce(new ApiError(0, 'network error'))
      .mockResolvedValueOnce('tok');

    renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(0);

    // Backoff is jittered (0.5x-1.5x of the base 1s delay, see R28) — advance
    // to the top of that range, not the old exact 1s, so this isn't flaky.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('calls onOpen on every successful connect and resets the backoff after one', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const onOpen = vi.fn();
    renderHook(() => useSSE('/api/stream', vi.fn(), onOpen));
    await vi.advanceTimersByTimeAsync(0);

    latestSource().onopen?.();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Fail once after a successful connect — the next reconnect should
    // happen after the base backoff again, not a further-escalated one,
    // proving onopen reset the attempt counter.
    latestSource().onerror?.();
    // Jittered range (0.5x-1.5x base) — advance to the top of it.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances).toHaveLength(2);

    latestSource().onopen?.();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('parses incoming messages as JSON and forwards them to onMessage', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const onMessage = vi.fn();
    renderHook(() => useSSE('/api/stream', onMessage));
    await vi.advanceTimersByTimeAsync(0);

    const msg: SSEMessage = { type: 'menu_update' };
    latestSource().onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
    expect(onMessage).toHaveBeenCalledWith(msg);
  });

  it('ignores a malformed message instead of throwing', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const onMessage = vi.fn();
    renderHook(() => useSSE('/api/stream', onMessage));
    await vi.advanceTimersByTimeAsync(0);

    expect(() => latestSource().onmessage?.({ data: 'not json' } as MessageEvent)).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('closes the EventSource and stops retrying on unmount', async () => {
    vi.mocked(authApi.mintSSETicket).mockResolvedValue('tok');
    const { unmount } = renderHook(() => useSSE('/api/stream', vi.fn()));
    await vi.advanceTimersByTimeAsync(0);

    const es = latestSource();
    unmount();
    expect(es.closed).toBe(true);

    es.onerror?.(); // late/racing event after unmount must not schedule anything
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('does nothing when path is null', async () => {
    renderHook(() => useSSE(null, vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    expect(authApi.mintSSETicket).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
