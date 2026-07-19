import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    // Check if already installed
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as any).standalone === true);

    if (isStandalone) {
      return;
    }

    // Check for iOS Safari. iPadOS 13+ reports a desktop-Mac userAgent (no
    // "iPad" substring) — navigator.maxTouchPoints > 1 is what actually
    // distinguishes it from a real Mac, which reports 0.
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (isIos) {
      const dismissed = localStorage.getItem('khaao_install_dismissed');
      if (!dismissed) {
        setShowIosHint(true);
      }
    }

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
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-ink/5 hover:text-ink transition"
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
        <button
          onClick={handleInstallClick}
          className="mt-3 w-full rounded-lg bg-brand py-2 text-sm font-bold text-white transition hover:bg-brand-dark active:scale-[0.98]"
        >
          Install
        </button>
      )}
    </div>
  );
}
