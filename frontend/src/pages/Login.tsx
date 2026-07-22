import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { fetchAuthConfig } from '../api/auth';

export function Login() {
  const { loginWithGoogle, completeGoogleRedirect, isAuthenticated, user } = useAuth();
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

  // Standalone-PWA sign-in hands the window off via signInWithRedirect and
  // comes back here — pick up the result once on mount. In the common case
  // there's no pending redirect and this resolves near-instantly, so don't
  // flip the spinner on synchronously — that just flashes it for one frame.
  // Instead, only show it if completeGoogleRedirect() is still pending after
  // a short delay, which is the "a real redirect is actually resolving" case.
  useEffect(() => {
    let cancelled = false;
    const spinnerDelay = window.setTimeout(() => {
      if (!cancelled) setSubmitting(true);
    }, 180);
    completeGoogleRedirect()
      .then((loggedInUser) => {
        if (cancelled || !loggedInUser) return;
        navigate(loggedInUser.role === 'shopkeeper' ? '/shop' : '/', { replace: true });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : err?.message || 'Something went wrong. Please try again.',
        );
      })
      .finally(() => {
        window.clearTimeout(spinnerDelay);
        if (!cancelled) setSubmitting(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(spinnerDelay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGoogleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      // signInWithGoogle (dynamically imported inside loginWithGoogle) throws
      // its own "Firebase is not configured" error if the SDK didn't init —
      // no need to duplicate that check here.
      const loggedInUser = await loginWithGoogle();
      // null means standalone mode handed the window off via redirect — the
      // page is navigating away, nothing left to do here.
      if (loggedInUser) {
        navigate(loggedInUser.role === 'shopkeeper' ? '/shop' : '/', { replace: true });
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') return;
      setError(
        err instanceof ApiError ? err.message : err.message || 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-steel px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-ink bg-paper font-display text-xl font-bold text-ink">
            K
          </span>
          <h1 className="font-display text-2xl font-bold uppercase tracking-[0.15em] text-ink">Khaao</h1>
          <p
            className="animate-stamp font-display text-xs uppercase tracking-widest text-ink/50"
            style={{ '--stamp-rot': '-3deg', animationDelay: '200ms' } as CSSProperties}
          >
            Order ahead · Skip the line
          </p>
        </div>

        <div
          className="ticket-notch animate-slide-up relative flex flex-col items-center rounded-2xl border-2 border-dashed border-ink/25 bg-paper p-6 shadow-ticket"
          style={{ '--ticket-notch-bg': '#dce4de' } as CSSProperties}
        >
          <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-widest text-ink/70">
            Sign in
          </h2>

          {error && (
            <div className="mb-4 w-full rounded-md border border-stamp/40 bg-stamp-light px-3 py-2 text-sm font-medium text-stamp-dark">
              {error}
            </div>
          )}

          <Button type="button" onClick={handleGoogleLogin} fullWidth loading={submitting}>
            Continue with Google
          </Button>

          <p className="mt-4 text-center text-sm text-ink/60">Use your @{domain} account</p>
        </div>
      </div>
    </div>
  );
}
