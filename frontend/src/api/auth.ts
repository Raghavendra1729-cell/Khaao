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

export function logout(): void {
  clearAuthStorage();
}
