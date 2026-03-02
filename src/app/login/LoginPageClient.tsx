'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

type SessionInfo = {
  enabled: boolean;
  authenticated: boolean;
  email: string | null;
};

function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return '/';
  if (!nextPath.startsWith('/')) return '/';
  if (nextPath.startsWith('//')) return '/';
  return nextPath;
}

function resolveErrorMessage(errorCode: string | null): string | null {
  switch (errorCode) {
    case 'auth0_error':
      return 'Auth0 rejected the login request. Please try again.';
    case 'invalid_state':
      return 'Login state has expired or is invalid. Request a new magic link.';
    case 'token_exchange_failed':
      return 'Failed to verify the magic link. Please request another one.';
    case 'email_not_found':
      return 'Authenticated account email was not returned by Auth0.';
    case 'not_whitelisted':
      return 'This email is not whitelisted in this Palx instance.';
    default:
      return null;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get('next')), [searchParams]);
  const callbackError = useMemo(() => resolveErrorMessage(searchParams.get('error')), [searchParams]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to fetch auth session');
        }

        const data = await response.json() as SessionInfo;
        if (!active) return;

        setSessionInfo(data);

        if (data.authenticated) {
          router.replace(nextPath);
          return;
        }
      } catch {
        if (!active) return;
        setRequestError('Failed to load login status. Refresh and try again.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [nextPath, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, next: nextPath }),
      });

      const data = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        setRequestError(typeof data.error === 'string' ? data.error : 'Failed to request a magic link.');
        return;
      }

      setSuccessMessage('Magic link sent. Check your email and open the link in this browser.');
    } catch {
      setRequestError('Failed to request a magic link.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f6f8] p-6 dark:bg-[#0d1117]">
        <span className="loading loading-spinner loading-lg text-primary" aria-label="Loading" />
      </main>
    );
  }

  if (!sessionInfo?.enabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f6f8] p-6 dark:bg-[#0d1117]">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Login disabled</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Auth0 credentials are not configured. Access is currently allowed without authentication.
          </p>
          <Link href={nextPath} className="btn btn-primary btn-sm mt-5">
            Continue to app
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f6f8] p-6 dark:bg-[#0d1117]">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Sign in with email</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Enter your whitelisted email address to receive an Auth0 magic link.
        </p>

        {(callbackError || requestError) && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
            {callbackError || requestError}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-300">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="form-control w-full">
            <span className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
            <input
              type="email"
              required
              className="input input-bordered w-full"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? <span className="loading loading-spinner loading-xs" aria-hidden="true" /> : null}
            Send magic link
          </button>
        </form>
      </div>
    </main>
  );
}
