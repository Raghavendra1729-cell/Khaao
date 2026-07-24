import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PushNotificationSetup } from './PushNotificationSetup';
import { LanguageProvider } from '../../context/LanguageContext';
import { ToastProvider } from '../ui/Toast';
import { setInstallPromptShowing } from '../../lib/promptCoordination';

function renderPush() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <PushNotificationSetup isShop={false} />
      </ToastProvider>
    </LanguageProvider>,
  );
}

// Microtask-only flush (not a real timer) — keeps every step inside the
// same act() tracking window; a setTimeout-based flush let scheduled React
// work land just outside it.
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// Guards against InstallPrompt and PushNotificationSetup both rendering at
// the shared bottom-sheet slot at once — see promptCoordination.ts. A prior
// fix (F-series) closed the iOS-hint version of this race by computing
// showIosHint synchronously. The Android/desktop native-prompt path
// (`beforeinstallprompt`) can't be made synchronous the same way — the event
// fires whenever the browser decides to, including *during* this
// component's own async subscription check — so the check must be re-read
// right before actually deciding to show, not just once at mount.
describe('PushNotificationSetup vs InstallPrompt slot race', () => {
  let resolveSubscription: (sub: unknown) => void;

  beforeEach(() => {
    setInstallPromptShowing(false);
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', { permission: 'default' });

    const subscriptionPromise = new Promise((resolve) => {
      resolveSubscription = resolve;
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => subscriptionPromise },
        }),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    setInstallPromptShowing(false);
    vi.unstubAllGlobals();
    // @ts-expect-error -- test-only cleanup of a property defined above
    delete navigator.serviceWorker;
  });

  it('does not show the push prompt if the install card starts showing while the subscription check is in flight', async () => {
    await act(async () => {
      renderPush();

      // Let the mount effect's first promise leg (serviceWorker.ready)
      // settle, reaching the point of awaiting the still-pending
      // subscription lookup.
      await flush();

      // Simulate InstallPrompt's `beforeinstallprompt` firing *after* mount
      // but *before* this component's own async subscription check
      // resolves — a real ordering the browser controls, not this app.
      setInstallPromptShowing(true);
      await flush();

      resolveSubscription(undefined); // no existing subscription -> would otherwise show
      await flush();
    });

    expect(screen.queryByText('Enable Notifications')).not.toBeInTheDocument();
  });

  it('still shows the push prompt when the install slot stays free throughout', async () => {
    renderPush();

    await act(async () => {
      resolveSubscription(undefined);
      await flush();
    });

    expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
  });
});
