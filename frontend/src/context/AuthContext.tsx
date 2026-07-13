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
import { signInWithGoogle } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  loginWithGoogle: () => Promise<User>;
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

  async function loginWithGoogleAction(): Promise<User> {
    setAuthLoading(true);
    try {
      const config = await authApi.fetchAuthConfig();
      const idToken = await signInWithGoogle(config.allowed_email_domain);
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
