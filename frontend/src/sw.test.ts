import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sw.ts runs in the ServiceWorkerGlobalScope, not jsdom's window. Mock the
// workbox modules it imports so we can assert on how it calls them, and
// stub `self` with just enough of the SW surface for the module's top-level
// side effects (and its two event listeners) to run.

const precacheAndRoute = vi.fn();
const createHandlerBoundToURL = vi.fn(() => 'bound-handler');
const cleanupOutdatedCaches = vi.fn();
vi.mock('workbox-precaching', () => ({
  precacheAndRoute,
  createHandlerBoundToURL,
  cleanupOutdatedCaches,
}));

const NavigationRoute = vi.fn();
const registerRoute = vi.fn();
vi.mock('workbox-routing', () => ({
  NavigationRoute,
  registerRoute,
}));

const NetworkOnly = vi.fn();
vi.mock('workbox-strategies', () => ({
  NetworkOnly,
}));

const clientsClaim = vi.fn();
vi.mock('workbox-core', () => ({
  clientsClaim,
}));

type Listener = (event: unknown) => unknown;

function makeSelf() {
  const listeners: Record<string, Listener[]> = {};
  return {
    __WB_MANIFEST: [],
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, cb: Listener) => {
      (listeners[type] ??= []).push(cb);
    }),
    registration: {
      showNotification: vi.fn().mockResolvedValue(undefined),
      scope: 'https://khaao.example/',
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
    listeners,
  };
}

let selfMock: ReturnType<typeof makeSelf>;

async function loadSW() {
  vi.resetModules();
  selfMock = makeSelf();
  vi.stubGlobal('self', selfMock);
  await import('./sw');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sw.ts — W1: the worker must be able to activate an update', () => {
  it('calls self.skipWaiting() on evaluation', async () => {
    await loadSW();
    expect(selfMock.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('calls workbox-core clientsClaim() on evaluation', async () => {
    await loadSW();
    expect(clientsClaim).toHaveBeenCalledTimes(1);
  });

  it('calls cleanupOutdatedCaches() so old precache generations do not accumulate', async () => {
    await loadSW();
    expect(cleanupOutdatedCaches).toHaveBeenCalledTimes(1);
  });
});

describe('sw.ts — W9: notificationclick must not navigate off-origin', () => {
  async function fireNotificationClick(url: string | undefined) {
    await loadSW();
    const handlers = selfMock.listeners['notificationclick'];
    expect(handlers).toBeDefined();

    const close = vi.fn();
    let waited: Promise<unknown> = Promise.resolve();
    const event = {
      notification: { close, data: { url } },
      waitUntil: (p: Promise<unknown>) => {
        waited = p;
      },
    };

    handlers[0](event);
    await waited;
  }

  it('navigates to the payload path when it is same-origin (starts with a single "/")', async () => {
    await fireNotificationClick('/order');
    expect(selfMock.clients.openWindow).toHaveBeenCalledWith('/order');
  });

  it('falls back to "/" for an absolute cross-origin URL', async () => {
    await fireNotificationClick('https://evil.example/');
    expect(selfMock.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('falls back to "/" for a protocol-relative URL (would leave the origin)', async () => {
    await fireNotificationClick('//evil.example');
    expect(selfMock.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('falls back to "/" when no url is present in the payload', async () => {
    await fireNotificationClick(undefined);
    expect(selfMock.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
