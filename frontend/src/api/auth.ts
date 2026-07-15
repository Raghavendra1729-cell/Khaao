import { apiFetch, clearAuthStorage, setAuthStorage } from './client';
import type { AuthConfig, User } from './types';

export interface AuthResponse {
  token: string;
  user: User;
}

/** Returns configuration for the login screen. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  return apiFetch<AuthConfig>('/auth/config');
}

/** Exchange a Firebase ID token for a Khaao session. */
export async function loginWithFirebase(idToken: string): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/firebase', {
    method: 'POST',
    body: { id_token: idToken },
  });
  setAuthStorage(res.token, res.user);
  return res;
}

export async function fetchMe(): Promise<User> {
  const res = await apiFetch<{ user: User }>('/auth/me');
  return res.user;
}

/**
 * Mints a short-lived (~60s), single-use ticket for opening an SSE
 * (EventSource) connection. EventSource can't set an Authorization header,
 * so historically the real (7-day) JWT was passed as `?token=` — visible in
 * proxy/server logs and browser history for the token's whole lifetime.
 * Calling this via the normal authenticated `apiFetch` keeps the real JWT in
 * the Authorization header; only the disposable ticket ever reaches the
 * stream URL. See `hooks/useSSE.ts` (mints a fresh ticket per connect/
 * reconnect) and STATUS.md § P1-b.
 */
export async function mintSSETicket(): Promise<string> {
  const res = await apiFetch<{ ticket: string; expires_in: number }>('/auth/sse-ticket', {
    method: 'POST',
  });
  return res.ticket;
}

export function logout(): void {
  clearAuthStorage();
}
