import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { setInstallPromptShowing } from '../../lib/promptCoordination';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

/**
 * Whether the iOS "add to home screen" hint should show, computed
 * synchronously from state that's all available without any async work
 * (userAgent/maxTouchPoints/matchMedia/localStorage). This used to be set
 * via `setShowIosHint(true)` inside a mount effect, which meant the true
 * value only existed one render-tick after mount — late enough that
 * PushNotificationSetup's own one-shot mount effect (which checks
 * `promptCoordination`'s flag to avoid showing both prompt cards at once,
 * F9) could run its check *before* this component had announced it was
 * showing, letting both stack on a fresh iOS visit. Computing it as the
 * initial state value instead means it's correct on the very first render,
 * so the coordination effect below reports the right thing on the first
 * pass.
 */
function computeShowIosHint(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as any).standalone === true);
  if (isStandalone) return false;

  // iPadOS 13+ reports a desktop-Mac userAgent (no "iPad" substring) —
  // navigator.maxTouchPoints > 1 is what actually distinguishes it from a
  // real Mac, which reports 0.
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  return !localStorage.getItem('khaao_install_dismissed');
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIosHint, setShowIosHint] = useState(computeShowIosHint);

  useEffect(() => {
    // Listen for the install prompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Claim (or release) the shared bottom-sheet slot for PushNotificationSetup
  // to check — see promptCoordination.ts. Release it on unmount too, even
  // though this component stays mounted for the app's lifetime in practice.
  useEffect(() => {
    setInstallPromptShowing(showPrompt || showIosHint);
  }, [showPrompt, showIosHint]);
  useEffect(() => () => setInstallPromptShowing(false), []);

  if (!showPrompt && !showIosHint) {
    return null;
  }

  const handleInstallClick = () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    // Hide regardless of outcome since it only fires once per page load
    setShowPrompt(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    if (showIosHint) {
      localStorage.setItem('khaao_install_dismissed', '1');
      setShowIosHint(false);
    } else {
      setShowPrompt(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-sm rounded-xl border border-edge bg-paper p-4 shadow-ticket">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {showIosHint ? (
            <p className="text-sm font-medium text-ink">
              Add to your home screen: tap <span className="font-semibold">Share</span>, then{' '}
              <span className="font-semibold">"Add to Home Screen"</span>.
            </p>
          ) : (
            <>
              <p className="text-sm font-bold text-ink">Install Khaao</p>
              <p className="mt-0.5 text-xs text-ink/70">Order faster from your home screen.</p>
            </>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-ink/5 hover:text-ink transition"
          aria-label="Dismiss"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!showIosHint && (
        <Button type="button" onClick={handleInstallClick} fullWidth className="mt-3">
          Install
        </Button>
      )}
    </div>
  );
}
