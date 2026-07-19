import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import * as authApi from '../api/auth';
import { getStoredUser, getToken, onUnauthorized } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  /** Resolves to `null` when standalone mode redirected the window away. */
  loginWithGoogle: () => Promise<User | null>;
  /** Picks up a signInWithRedirect result; `null` when there wasn't one. */
  completeGoogleRedirect: () => Promise<User | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser<User>());
  const [authLoading, setAuthLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    return onUnauthorized(() => {
      setUser(null);
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  async function loginWithGoogleAction(): Promise<User | null> {
    setAuthLoading(true);
    try {
      // Dynamic import — the Firebase SDK is only needed at the moment
      // someone actually signs in, not on every page load for every
      // already-authenticated student browsing the menu (R24).
      const [{ signInWithGoogle }, config] = await Promise.all([
        import('../lib/firebase'),
        authApi.fetchAuthConfig(),
      ]);
      const idToken = await signInWithGoogle(config.allowed_email_domain);
      if (!idToken) return null; // standalone mode: window is redirecting away
      const res = await authApi.loginWithFirebase(idToken);
      setUser(res.user);
      return res.user;
    } finally {
      setAuthLoading(false);
    }
  }

  async function completeGoogleRedirectAction(): Promise<User | null> {
    const { getGoogleRedirectResult } = await import('../lib/firebase');
    const idToken = await getGoogleRedirectResult();
    if (!idToken) return null;
    setAuthLoading(true);
    try {
      const res = await authApi.loginWithFirebase(idToken);
      setUser(res.user);
      return res.user;
    } finally {
      setAuthLoading(false);
    }
  }

  function logout(): void {
    authApi.logout();
    setUser(null);
    navigate('/login', { replace: true });
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null && getToken() !== null,
      authLoading,
      loginWithGoogle: loginWithGoogleAction,
      completeGoogleRedirect: completeGoogleRedirectAction,
      logout,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, authLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
