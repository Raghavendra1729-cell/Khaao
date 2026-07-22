import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store coordinating the two bottom-sheet prompt cards
 * that both render at the identical `fixed inset-x-4 bottom-20` slot:
 * InstallPrompt and PushNotificationSetup. Only one should ever be visible
 * at a time. InstallPrompt writes its own visibility here whenever it's
 * actively showing (the native-prompt card or the iOS hint);
 * PushNotificationSetup reads it once, at the moment it would otherwise
 * decide to show, and simply stays hidden for the rest of the session if
 * the install card currently holds the slot — it does not re-check later,
 * so dismissing the install card mid-session won't retroactively pop the
 * push prompt open (no live re-trigger; push just waits for a later
 * session, or for the install card to not be showing next time this check
 * runs). Kept outside React, mirroring shopNotifications.ts's idiom, so the
 * writer (InstallPrompt) and the reader (PushNotificationSetup) don't need
 * a shared provider wrapping them.
 */
let installPromptShowing = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setInstallPromptShowing(showing: boolean): void {
  if (installPromptShowing === showing) return;
  installPromptShowing = showing;
  emit();
}

export function useInstallPromptShowing(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => installPromptShowing,
    () => false,
  );
}
