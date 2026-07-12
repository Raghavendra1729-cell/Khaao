import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';

export function Signup() {
  const { signup, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(user.role === 'shopkeeper' ? '/shop' : '/', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await signup(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-xl font-black text-white">
            K
          </span>
          <h1 className="text-2xl font-black tracking-tight text-brand-dark">Khaao</h1>
          <p className="text-sm text-ink/60">Create your student account</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-sage bg-white p-6 shadow-card">
          <h2 className="mb-4 text-lg font-bold text-ink">Sign up</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">Name</span>
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
              placeholder="Your name"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">College email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
              placeholder="you@college.edu"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">Password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
              placeholder="At least 6 characters"
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">Confirm password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-sage px-3 text-base focus:border-brand"
              placeholder="Repeat password"
            />
          </label>

          <Button type="submit" fullWidth loading={submitting}>
            Create account
          </Button>

          <p className="mt-4 text-center text-sm text-ink/60">
            Already have an account? <Link to="/login" className="font-semibold text-brand">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
