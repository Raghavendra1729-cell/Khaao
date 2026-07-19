// Fetch wrapper: base /api, JSON in/out, token from localStorage, throws ApiError.

const TOKEN_KEY = 'khaao_token';
const USER_KEY = 'khaao_user';
const UNAUTHORIZED_EVENT = 'khaao:unauthorized';

// TOKEN STORAGE TRADEOFF (deliberately left as-is this pass): the Khaao JWT
// lives in localStorage for up to 7 days, so it's exfiltratable by any XSS
// bug — a full HttpOnly-cookie session would close that gap but is a bigger
// change (touches CORS/CSRF, the Firebase-popup login flow, AUTH_FAKE dev
// testing) that deserves its own dedicated pass. See STATUS.md § P1-b for
// the fuller writeup before you pick this back up.

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser<T>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setAuthStorage(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthStorage(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Subscribe to "session expired" notifications raised by apiFetch on 401. */
export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  let body: string | undefined;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      // A request that hangs (mobile radio drops mid-request, no RST ever
      // arrives) would otherwise leave pending UI state until the browser's
      // own default gives up, which can take minutes. TimeoutError and any
      // other AbortError both land in this catch, alongside genuine network
      // failures — all surfaced the same way, since from the caller's
      // perspective both mean "the request didn't complete" (R31).
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(0, 'Network error — check your connection and try again.');
  }

  if (res.status === 401) {
    clearAuthStorage();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(401, 'Your session expired. Please log in again.');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}
