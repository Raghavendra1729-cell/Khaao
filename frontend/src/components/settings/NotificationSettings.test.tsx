import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NotificationSettings } from './NotificationSettings';
import { LanguageProvider } from '../../context/LanguageContext';
import { ToastProvider } from '../ui/Toast';

vi.mock('../../api/shop', () => ({
  getVapidPublicKey: vi.fn().mockResolvedValue({ public_key: 'AAAA' }),
  subscribeToPush: vi.fn().mockResolvedValue(undefined),
}));

function renderNotificationSettings() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <NotificationSettings isShop={false} />
      </ToastProvider>
    </LanguageProvider>,
  );
}

describe('NotificationSettings (STATUS.md § 9.7 P3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- test-only cleanup of a property defined in some cases below
    delete navigator.serviceWorker;
  });

  it('renders an honest unsupported message and no button when Notification is unavailable', () => {
    // jsdom has no Notification global by default — nothing to stub.
    renderNotificationSettings();
    expect(screen.getByText(/doesn't support notifications/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders per-browser instructions and no button when denied — the app cannot re-prompt', () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    renderNotificationSettings();
    expect(screen.getByText(/notifications are off/i)).toBeInTheDocument();
    expect(screen.getByText(/turn them back on/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an Enable notifications button in the default state', () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    renderNotificationSettings();
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
  });

  it('renders a Reconnect notifications button when granted but no subscription is confirmed', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }) },
      configurable: true,
    });

    renderNotificationSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reconnect notifications' })).toBeInTheDocument(),
    );
  });

  it('renders a confirmed message and no button when granted with a live subscription', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve({}) } }) },
      configurable: true,
    });

    renderNotificationSettings();
    await waitFor(() => expect(screen.getByText(/notifications are on/i)).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
