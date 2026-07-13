import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { app } from '../lib/firebase';
import { fetchAuthConfig } from '../api/auth';

export function Login() {
  const { loginWithGoogle, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [domain, setDomain] = useState('sst.scaler.com');

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(user.role === 'shopkeeper' ? '/shop' : '/', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => {
        if (config.allowed_email_domain) {
          setDomain(config.allowed_email_domain);
        }
      })
      .catch(() => {});
  }, []);

  async function handleGoogleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      if (!app) {
        throw new Error('Firebase is not configured. Please check your environment variables (.env).');
      }
      const loggedInUser = await loginWithGoogle();
      navigate(loggedInUser.role === 'shopkeeper' ? '/shop' : '/', { replace: true });
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') return;
      setError(err instanceof ApiError ? err.message : err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-xl font-black text-white">
            K
          </span>
          <h1 className="text-2xl font-black tracking-tight text-brand-dark">Khaao</h1>
          <p className="text-sm text-ink/60">Order ahead. Skip the line.</p>
        </div>

        <div className="rounded-2xl border border-sage bg-white p-6 shadow-card flex flex-col items-center">
          <h2 className="mb-4 text-lg font-bold text-ink">Log in</h2>

          {error && (
            <div className="mb-4 w-full rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <Button type="button" onClick={handleGoogleLogin} fullWidth loading={submitting}>
            Continue with Google
          </Button>

          <p className="mt-4 text-center text-sm text-ink/60">
            Use your @{domain} account
          </p>
        </div>
      </div>
    </div>
  );
}
