import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Only initialize if we have the config, else let the UI handle the missing env error
export const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

/**
 * True when running as an installed/standalone PWA. signInWithPopup is
 * unreliable-to-broken there, and on iOS the installed app has separate
 * storage from Safari — every iOS installer must log in *inside* the
 * standalone app, exactly where the popup flow fails.
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true);
}

function buildGoogleProvider(allowedDomain?: string): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  const customParams: Record<string, string> = { prompt: 'select_account' };
  if (allowedDomain) {
    customParams.hd = allowedDomain;
  }
  provider.setCustomParameters(customParams);
  return provider;
}

/**
 * Starts Google sign-in. Inside a standalone PWA this hands the whole window
 * off via signInWithRedirect and resolves with `null` — the page navigates
 * away, so there's nothing to return here; call getGoogleRedirectResult() on
 * the next load to pick up the outcome. Everywhere else it uses the popup
 * flow and resolves directly with an ID token.
 */
export async function signInWithGoogle(allowedDomain?: string): Promise<string | null> {
  if (!auth) {
    throw new Error('Firebase is not configured. Missing environment variables.');
  }
  const provider = buildGoogleProvider(allowedDomain);
  if (isStandalonePWA()) {
    await signInWithRedirect(auth, provider);
    return null;
  }
  const result = await signInWithPopup(auth, provider);
  return await result.user.getIdToken();
}

/**
 * Picks up the result of a signInWithRedirect started by signInWithGoogle in
 * standalone mode. Resolves to `null` when there was no pending redirect
 * (the common case — most sign-ins go through the popup flow). Safe to call
 * unconditionally on every Login mount.
 */
export async function getGoogleRedirectResult(): Promise<string | null> {
  if (!auth) return null;
  const result = await getRedirectResult(auth);
  if (!result) return null;
  return await result.user.getIdToken();
}
