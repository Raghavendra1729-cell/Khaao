import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { useInstallPromptShowing } from '../../lib/promptCoordination';
import { requestNotificationPermissionAndSubscribe, subscribeCurrentDevice } from '../../lib/push';
import { useToast } from '../ui/Toast';
import { Modal } from '../ui/Modal';

interface PushNotificationSetupProps {
  /** Gates Hindi copy explicitly, matching Layout.tsx's AvatarMenu — a
   * shopkeeper's stored 'hi' preference must never leak into a student
   * session on a shared device/browser. */
  isShop: boolean;
}

export function PushNotificationSetup({ isShop }: PushNotificationSetupProps) {
  const { language } = useLanguage();
  const { showToast } = useToast();
  const showHindi = isShop && language === 'hi';
  const [showPrompt, setShowPrompt] = useState(false);
  const [loading, setLoading] = useState(false);

  // InstallPrompt and this component render at the identical fixed
  // bottom-sheet slot — see promptCoordination.ts. This is read once, at
  // decision time inside the mount effect below (via the ref), not
  // reactively: if the install card is showing right now, this prompt just
  // stays hidden for the session. It deliberately does not re-check later,
  // so dismissing the install card mid-session won't pop this prompt open
  // (no live re-trigger, per design).
  const installPromptShowing = useInstallPromptShowing();
  const installPromptShowingRef = useRef(installPromptShowing);
  installPromptShowingRef.current = installPromptShowing;

  useEffect(() => {
    // Only run if service workers, push, and Notification itself are
    // supported — some webviews have serviceWorker/PushManager but no
    // Notification global, which would throw on the very next line.
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return;
    }

    if (Notification.permission === 'denied') {
      return;
    }

    // Check if dismissed in this session
    if (sessionStorage.getItem('khaao_push_dismissed')) {
      return;
    }

    // The install-prompt card already claims this slot — don't contest it.
    // This is deliberately *not* the only check: `beforeinstallprompt` is a
    // browser-timed event InstallPrompt can't announce synchronously (unlike
    // the iOS hint, which is computed as initial state for exactly this
    // reason — see InstallPrompt.tsx). It can fire at any point, including
    // while the async subscription lookup below is in flight, so the slot is
    // re-checked again right at the actual decision moment, not just here at
    // the start.
    if (installPromptShowingRef.current) {
      return;
    }

    let cancelled = false;
    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((subscription) => {
        if (cancelled || subscription || installPromptShowingRef.current) return;
        // A backend can prune an expired subscription while the browser still
        // holds permission. Repair that normal case quietly on mount; the
        // visible card remains as a recovery path if the repair cannot reach
        // the network. This keeps a granted device from losing ready alerts
        // until somebody happens to open Settings.
        if (Notification.permission === 'granted') {
          void subscribeCurrentDevice().catch(() => {
            if (!cancelled) setShowPrompt(true);
          });
          return;
        }
        setShowPrompt(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const permission = await requestNotificationPermissionAndSubscribe();
      if (permission !== 'granted') {
        setShowPrompt(false);
        return;
      }

      setShowPrompt(false);
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
      showToast(
        showHindi
          ? 'सूचनाएं चालू नहीं हो सकीं। कृपया पुनः प्रयास करें।'
          : "Couldn't enable notifications. Please try again.",
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem('khaao_push_dismissed', '1');
    setShowPrompt(false);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <Modal
      open
      onClose={handleDismiss}
      title={showHindi ? 'सूचनाएं चालू करें' : 'Enable Notifications'}
      size="sm"
      footer={
        <Button type="button" onClick={handleEnable} loading={loading} fullWidth>
          {showHindi ? 'चालू करें' : 'Enable'}
        </Button>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm text-ink/70">
            {isShop
              ? showHindi
                ? 'टैब बंद होने पर भी नए ऑर्डर की सूचना पाएं।'
                : 'Get notified of new orders even when this tab is closed.'
              : 'Get notified the moment your order is ready — even with your screen locked.'}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-ink/5 hover:text-ink"
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
    </Modal>
  );
}
