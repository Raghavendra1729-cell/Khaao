import { useSyncExternalStore } from 'react';

/**
 * Single source of truth for "can this device install Khaao right now," read
 * by both the one-shot InstallPrompt card and the always-available Settings
 * → "Get the app" section (STATUS.md § 9.7 P2/P6).
 *
 * `promptable`'s deferred `beforeinstallprompt` event is captured by a
 * listener registered below, at MODULE SCOPE — this file is imported by
 * main.tsx before React mounts specifically so that registration happens
 * before the event can possibly fire. A component-scoped listener (the old
 * InstallPrompt.tsx shape) misses the event on every render after the first
 * one where nothing was listening yet, which is exactly why the old card was
 * one-shot: dismiss it once and the captured event was gone for the rest of
 * the page load, with nothing else able to ever use it.
 */
export type InstallState =
  | { kind: 'installed' }
  | { kind: 'promptable'; prompt(): Promise<void> }
  | { kind: 'ios-manual' }
  | { kind: 'unsupported' };

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

// Shared with the dismiss card's old key on purpose — device-scoped, not
// account-scoped, so api/client.ts's clearAuthStorage() deliberately leaves
// it alone across logout (see its comment). The *value* changed from a bare
// '1' to a timestamp so dismissal can be time-boxed (P6) instead of
// permanent.
const DISMISS_KEY = 'khaao_install_dismissed';
const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

let deferredEvent: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const matches =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    'standalone' in navigator && (navigator as unknown as { standalone?: boolean }).standalone === true;
  return matches === true || iosStandalone === true;
}

// iPadOS 13+ reports a desktop-Mac userAgent (no "iPad" substring) —
// navigator.maxTouchPoints > 1 is what actually distinguishes it from a real
// Mac, which reports 0. Mirrors InstallPrompt.tsx's prior detection.
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Runs the captured native install prompt and awaits the user's real choice
 * before touching any state. The bug this replaces (InstallPrompt.tsx ~line
 * 78, pre-P2) called `.prompt()` and immediately discarded the deferred event
 * without awaiting `userChoice` — so cancelling the OS dialog lost the
 * install opportunity forever, identically to accepting it. Only an
 * `'accepted'` outcome clears the held event here; a `'dismissed'` outcome
 * leaves it in place so the button stays usable on a later tap.
 */
async function promptInstall(): Promise<void> {
  const event = deferredEvent;
  if (!event) return;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') {
    deferredEvent = null;
  }
  emit();
}

// Cached singletons, one per state shape — useSyncExternalStore requires
// getSnapshot to return a referentially stable value when nothing has
// changed, or React re-renders forever (a real "Maximum update depth
// exceeded" this file hit while under test: a fresh `{ kind: ... }` literal
// on every call reads as "state changed" on every single render).
const INSTALLED_STATE: InstallState = { kind: 'installed' };
const IOS_MANUAL_STATE: InstallState = { kind: 'ios-manual' };
const UNSUPPORTED_STATE: InstallState = { kind: 'unsupported' };
const PROMPTABLE_STATE: InstallState = { kind: 'promptable', prompt: promptInstall };

export function getInstallState(): InstallState {
  if (installed || isStandalone()) return INSTALLED_STATE;
  if (deferredEvent) return PROMPTABLE_STATE;
  if (isIos()) return IOS_MANUAL_STATE;
  return UNSUPPORTED_STATE;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getInstallState, () => ({ kind: 'unsupported' }));
}

/** Whether the one-shot InstallPrompt card was dismissed inside the last
 * ~30 days — both iOS and Android/desktop share this single, time-boxed
 * check (P6) instead of iOS's old permanent `localStorage` write next to
 * Android's old permanent-per-page-load discard. Settings' "Get the app"
 * section is now the always-available path, so the card only needs to be a
 * polite nudge, not a last chance — it's fine to come back in a month. */
export function isInstallCardDismissedRecently(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < DISMISS_WINDOW_MS;
}

export function dismissInstallCard(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredEvent = e as BeforeInstallPromptEvent;
    emit();
  });

  // A student who installs via the browser's own menu (bypassing our card)
  // still fires this — flip shared state so every mounted consumer
  // self-corrects with no extra wiring, and forgive any prior dismissal so a
  // *re-install* later (a fresh browser profile, a cleared app) isn't stuck
  // behind a stale timestamp.
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredEvent = null;
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DISMISS_KEY);
    emit();
  });
}

/** Test-only: clears module state between test cases. Not called by app code
 * — the listeners above are registered once, at module load, for the whole
 * page lifetime in production. */
export function __resetInstallStateForTests(): void {
  deferredEvent = null;
  installed = false;
}
