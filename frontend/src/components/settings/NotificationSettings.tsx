import { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import {
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
  requestNotificationPermissionAndSubscribe,
  subscribeCurrentDevice,
} from '../../lib/push';

interface NotificationSettingsProps {
  /** Gates Hindi copy explicitly, matching AvatarMenu/PushNotificationSetup —
   * a shopkeeper's stored 'hi' preference must never leak into a student
   * session on a shared device. */
  isShop: boolean;
}

type SubscriptionState = 'checking' | 'confirmed' | 'missing';

/** The app cannot re-prompt after a browser-level denial — that's a browser
 * rule, not a Khaao limitation — so the honest fix is per-browser
 * instructions to re-allow manually, not a dead button. */
function reenableInstructions(showHindi: boolean): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  if (isIos) {
    return showHindi
      ? 'सूचनाएं फिर चालू करने के लिए: iPhone की Settings ऐप खोलें → Notifications → Khaao ढूंढें → चालू करें।'
      : 'To turn them back on: open the iPhone Settings app → Notifications → Khaao, and allow them.';
  }
  if (isAndroid) {
    return showHindi
      ? 'सूचनाएं फिर चालू करने के लिए: ब्राउज़र में इस साइट की सेटिंग्स खोलें → Notifications → अनुमति दें।'
      : "To turn them back on: open this browser's site settings for Khaao and allow notifications.";
  }
  return showHindi
    ? 'सूचनाएं फिर चालू करने के लिए: पता बार के पास मौजूद साइट सेटिंग्स खोलें → Notifications → अनुमति दें।'
    : 'To turn them back on: open the site settings next to your address bar and allow notifications.';
}

/**
 * Settings' always-available notifications section (STATUS.md § 9.7 P3).
 * PushNotificationSetup is the one-shot bottom-sheet nudge; this is the
 * permanent path back for a student who dismissed it, blocked it, or just
 * wants to check whether it's actually working.
 */
export function NotificationSettings({ isShop }: NotificationSettingsProps) {
  const { language } = useLanguage();
  const showHindi = isShop && language === 'hi';
  const { showToast } = useToast();

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    getNotificationPermission,
  );
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>('checking');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPushSupported() || permission !== 'granted') {
      setSubscriptionState('missing');
      return;
    }
    let cancelled = false;
    setSubscriptionState('checking');
    getExistingSubscription().then((sub) => {
      if (cancelled) return;
      setSubscriptionState(sub ? 'confirmed' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [permission]);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const result = await requestNotificationPermissionAndSubscribe();
      setPermission(result);
    } catch {
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

  const handleReconnect = async () => {
    setLoading(true);
    try {
      await subscribeCurrentDevice();
      setSubscriptionState('confirmed');
    } catch {
      showToast(
        showHindi
          ? 'सूचनाएं फिर से नहीं जुड़ सकीं। कृपया पुनः प्रयास करें।'
          : "Couldn't reconnect notifications. Please try again.",
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  if (permission === 'unsupported') {
    return (
      <p className="text-sm text-ink/70">
        {showHindi
          ? 'यह ब्राउज़र सूचनाओं का समर्थन नहीं करता।'
          : "This browser doesn't support notifications."}
      </p>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-stamp-dark">
          {showHindi
            ? 'सूचनाएं बंद हैं — आपको पता नहीं चलेगा कि आपका खाना कब तैयार है'
            : "Notifications are off — you won't know when your food is ready"}
        </p>
        <p className="text-sm text-ink/70">{reenableInstructions(showHindi)}</p>
      </div>
    );
  }

  if (permission === 'default') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/70">
          {showHindi
            ? 'सूचनाएं बंद हैं — आपको पता नहीं चलेगा कि आपका खाना कब तैयार है।'
            : "Notifications are off — you won't know when your food is ready."}
        </p>
        <Button type="button" onClick={handleEnable} loading={loading} fullWidth>
          {showHindi ? 'सूचनाएं चालू करें' : 'Enable notifications'}
        </Button>
      </div>
    );
  }

  // permission === 'granted' from here down.
  if (subscriptionState === 'checking') {
    return <p className="text-sm text-ink/50">{showHindi ? 'जांच जारी है…' : 'Checking…'}</p>;
  }

  if (subscriptionState === 'missing') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink/70">
          {showHindi
            ? 'सूचनाओं की अनुमति है, पर यह डिवाइस अभी जुड़ा नहीं है।'
            : "Notifications are allowed, but this device isn't connected yet."}
        </p>
        <Button type="button" onClick={handleReconnect} loading={loading} fullWidth>
          {showHindi ? 'सूचनाएं फिर से जोड़ें' : 'Reconnect notifications'}
        </Button>
      </div>
    );
  }

  return <p className="text-sm text-ink/70">{showHindi ? 'सूचनाएं चालू हैं।' : 'Notifications are on.'}</p>;
}
