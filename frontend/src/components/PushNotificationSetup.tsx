import { useEffect, useState } from 'react';
import { getVapidPublicKey, subscribeToPush } from '../api/shop';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationSetup() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Only run if service workers and push are supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    if (Notification.permission === 'denied') {
      return;
    }

    // Check if dismissed in this session
    if (sessionStorage.getItem('khaao_push_dismissed')) {
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

      await subscribeToPush(
        subData.endpoint,
        subData.keys.p256dh,
        subData.keys.auth
      );

      setShowPrompt(false);
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
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
          <p className="text-sm font-bold text-ink">Enable Notifications</p>
          <p className="mt-0.5 text-xs text-ink/70">
            Get notified of new orders even when this tab is closed.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-ink/5 hover:text-ink"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <button
        onClick={handleEnable}
        disabled={loading}
        className="mt-3 w-full rounded-lg bg-brand py-2 text-sm font-bold text-white transition hover:bg-brand-dark active:scale-[0.98] disabled:opacity-50"
      >
        <div className="flex flex-col items-center leading-tight">
          <span>{loading ? 'Enabling...' : 'Enable'}</span>
          {!loading && <span className="text-[10px] font-medium opacity-80 mt-0.5">चालू करें</span>}
        </div>
      </button>
    </div>
  );
}
