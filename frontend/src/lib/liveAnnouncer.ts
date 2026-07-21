import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store for the visually-hidden aria-live region (G7).
 * StudentRealtime / ShopRealtime already detect the handful of status
 * transitions that get a chime + vibration + visual stamp; they call
 * `announce(text)` at exactly those same sites so a screen-reader user gets
 * the same headline moment sighted/hearing users get, instead of silence.
 * Kept outside React so the writers (return null) and the one reader
 * (Layout's live region) don't need a shared provider — same pattern as
 * shopNotifications.ts's module-level store.
 */
interface Snapshot {
  message: string;
  key: number;
}

let snapshot: Snapshot = { message: '', key: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Announces `text` via the live region. Bumps `key` even on a repeated
 * identical string so back-to-back same-text announcements (rare, but
 * possible) still register as a DOM mutation for the screen reader. */
export function announce(text: string): void {
  snapshot = { message: text, key: snapshot.key + 1 };
  emit();
}

export function useLiveAnnouncement(): Snapshot {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
    () => snapshot,
  );
}
