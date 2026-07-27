import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GetTheApp } from './GetTheApp';
import { LanguageProvider } from '../../context/LanguageContext';
import { __resetInstallStateForTests } from '../../lib/install';

function renderGetTheApp() {
  return render(
    <LanguageProvider>
      <GetTheApp isShop={false} />
    </LanguageProvider>,
  );
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Minimal stand-in for the real `BeforeInstallPromptEvent` — jsdom doesn't
 * implement it, and this is exactly the shape lib/install.ts reads
 * (`prompt()` + `userChoice`). */
function dispatchFakeInstallPrompt(
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>,
) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  const promptMock = vi.fn().mockResolvedValue(undefined);
  event.prompt = promptMock;
  event.userChoice = userChoice;
  window.dispatchEvent(event);
  return promptMock;
}

describe('GetTheApp (STATUS.md § 9.7 P2/P6)', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetInstallStateForTests();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    // Baseline: a generic desktop UA so tests run deterministically
    // regardless of order — the ios-manual test overrides this itself.
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
    __resetInstallStateForTests();
    vi.unstubAllGlobals();
  });

  it('renders the unsupported state with no button when nothing is installable', () => {
    renderGetTheApp();
    expect(screen.getByText(/open this site in chrome or safari/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a Download Khaao button in the promptable state and calls prompt() on tap', async () => {
    let resolveChoice: (v: { outcome: 'accepted' | 'dismissed'; platform: string }) => void = () => {};
    const userChoice = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>((resolve) => {
      resolveChoice = resolve;
    });
    const promptMock = dispatchFakeInstallPrompt(userChoice);

    renderGetTheApp();
    const button = await screen.findByRole('button', { name: 'Download Khaao' });

    await act(async () => {
      fireEvent.click(button);
      await flush();
    });

    expect(promptMock).toHaveBeenCalledTimes(1);

    // Cancelling the OS dialog must not lose the install opportunity — the
    // bug this replaces (pre-P2 InstallPrompt.tsx) dropped the deferred
    // event without awaiting userChoice at all.
    await act(async () => {
      resolveChoice({ outcome: 'dismissed', platform: 'web' });
      await flush();
    });

    expect(screen.getByRole('button', { name: 'Download Khaao' })).toBeInTheDocument();
  });

  it('renders numbered Share steps (no emoji) in the ios-manual state', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

    renderGetTheApp();
    expect(screen.getByText('Share')).toBeInTheDocument();
    expect(screen.getByText('"Add to Home Screen"')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a stamped "Installed" confirmation with no button once installed', async () => {
    renderGetTheApp();

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
      await flush();
    });

    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('appinstalled clears a prior dismissal timestamp (P6)', async () => {
    localStorage.setItem('khaao_install_dismissed', String(Date.now()));

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
      await flush();
    });

    expect(localStorage.getItem('khaao_install_dismissed')).toBeNull();
  });
});
