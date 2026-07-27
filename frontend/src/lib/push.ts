import { getVapidPublicKey, subscribeToPush } from '../api/shop';

/**
 * Shared Web Push subscribe flow — the single implementation for both
 * PushNotificationSetup's one-shot bottom-sheet card and Settings'
 * always-available Notifications section (STATUS.md § 9.7 P3). Previously
 * this logic lived only inside PushNotificationSetup.handleEnable; pulling it
 * out means both call sites subscribe identically instead of drifting.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** `'unsupported'` when the Notification API doesn't exist at all (some
 * webviews) — kept distinct from the real `NotificationPermission` values so
 * callers can render an honest "notifications aren't available here" state
 * instead of silently treating it as `'default'`. */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Subscribes this device to Web Push, assuming permission is already
 * `'granted'`. Used both by the initial enable flow (after
 * `requestPermission()` succeeds) and by Settings' "Reconnect notifications"
 * action for a browser that's granted but has no confirmed subscription. */
export async function subscribeCurrentDevice(): Promise<void> {
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
}

/** Requests notification permission and, if granted, subscribes this device.
 * Returns the resulting permission so the caller can react to `'denied'`
 * without needing a second permission read. */
export async function requestNotificationPermissionAndSubscribe(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  await subscribeCurrentDevice();
  return permission;
}

/** Whether this device already holds a live push subscription — `null` when
 * service workers aren't supported at all. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}
