import { apiFetch, clearAuthStorage, setAuthStorage } from './client';
import type { AuthConfig, User } from './types';

export interface AuthResponse {
  token: string;
  user: User;
}

/** Which sign-in methods the login screen should offer. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  return apiFetch<AuthConfig>('/auth/config');
}

export async function signup(name: string, email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: { name, email, password },
  });
  setAuthStorage(res.token, res.user);
  return res;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setAuthStorage(res.token, res.user);
  return res;
}

/** Exchange a Google Identity Services ID token for a Khaao session. */
export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/google', {
    method: 'POST',
    body: { credential },
  });
  setAuthStorage(res.token, res.user);
  return res;
}

/** Start a throwaway 24h guest session — name only, no account. */
export async function loginAsGuest(name: string): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/guest', {
    method: 'POST',
    body: { name },
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
