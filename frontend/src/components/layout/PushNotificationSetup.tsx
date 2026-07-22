import { useEffect, useRef, useState } from 'react';
import { getVapidPublicKey, subscribeToPush } from '../../api/shop';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { useInstallPromptShowing } from '../../lib/promptCoordination';
import { useToast } from '../ui/Toast';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
    if (installPromptShowingRef.current) {
      return;
    }

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((subscription) => {
        if (!subscription) {
          setShowPrompt(true);
        }
      });
    });
  }, []);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setShowPrompt(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      const { public_key } = await getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(public_key);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subData = subscription.toJSON();
      if (!subData.endpoint || !subData.keys?.p256dh || !subData.keys?.auth) {
        throw new Error('Invalid subscription format');
      }

      await subscribeToPush(subData.endpoint, subData.keys.p256dh, subData.keys.auth);

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
    <div className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-sm rounded-xl border border-edge bg-paper p-4 shadow-ticket">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-bold text-ink">
            {showHindi ? 'सूचनाएं चालू करें' : 'Enable Notifications'}
          </p>
          <p className="mt-0.5 text-xs text-ink/70">
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

      <Button type="button" onClick={handleEnable} loading={loading} fullWidth className="mt-3">
        {showHindi ? 'चालू करें' : 'Enable'}
      </Button>
    </div>
  );
}
