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
  login: (email: string, password: string) => Promise<User>;
  signup: (name: string, email: string, password: string) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
  loginAsGuest: (name: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser<User>());
  const [authLoading, setAuthLoading] = useState(false);
  const navigate = useNavigate();

  // If the API ever rejects our token (401), drop local session state and
  // send the user back to the login screen.
  useEffect(() => {
    return onUnauthorized(() => {
      setUser(null);
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  async function runLogin(fn: () => Promise<authApi.AuthResponse>): Promise<User> {
    setAuthLoading(true);
    try {
      const res = await fn();
      setUser(res.user);
      return res.user;
    } finally {
      setAuthLoading(false);
    }
  }

  const login = (email: string, password: string) => runLogin(() => authApi.login(email, password));
  const signup = (name: string, email: string, password: string) =>
    runLogin(() => authApi.signup(name, email, password));
  const loginWithGoogle = (credential: string) => runLogin(() => authApi.loginWithGoogle(credential));
  const loginAsGuest = (name: string) => runLogin(() => authApi.loginAsGuest(name));

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
      login,
      signup,
      loginWithGoogle,
      loginAsGuest,
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
