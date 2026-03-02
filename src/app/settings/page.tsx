'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronRight, KeyRound, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

type SessionInfo = {
  enabled: boolean;
  authenticated: boolean;
  email: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const flashMessage = error
    ? { tone: 'error' as const, text: error }
    : success
      ? { tone: 'success' as const, text: success }
      : null;
  const panelClass = 'overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-800 dark:shadow-[0_12px_30px_-18px_rgba(2,6,23,0.9)]';
  const sectionHeaderClass = 'flex flex-col gap-3 border-b border-slate-200 bg-white px-6 py-5 md:flex-row md:items-center md:justify-between dark:border-slate-700/50 dark:bg-slate-800';
  const inputClass = 'block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/50 dark:text-white dark:placeholder-slate-500 dark:focus:border-primary/50 dark:focus:bg-slate-900';
  const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
  const rowActionButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 dark:text-slate-400 dark:hover:bg-red-900/30 dark:hover:text-red-400';

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [sessionResponse, whitelistResponse] = await Promise.all([
          fetch('/api/auth/session', { cache: 'no-store' }),
          fetch('/api/auth/whitelist', { cache: 'no-store' }),
        ]);

        if (!sessionResponse.ok) {
          throw new Error('Failed to load auth session');
        }

        if (!whitelistResponse.ok) {
          throw new Error('Failed to load whitelist');
        }

        const sessionData = await sessionResponse.json() as SessionInfo;
        const whitelistData = await whitelistResponse.json() as { patterns?: string[] };

        if (!active) return;

        setSessionInfo(sessionData);
        setPatterns(Array.isArray(whitelistData.patterns) ? whitelistData.patterns : []);
      } catch {
        if (!active) return;
        setError('Failed to load whitelist settings.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const normalizedNewPattern = useMemo(() => newPattern.trim(), [newPattern]);

  const handleAddPattern = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedNewPattern) return;

    const hasDuplicate = patterns.some((pattern) => pattern.toLowerCase() === normalizedNewPattern.toLowerCase());
    if (hasDuplicate) {
      setError('Pattern already exists.');
      return;
    }

    setPatterns((current) => [...current, normalizedNewPattern]);
    setNewPattern('');
    setError(null);
    setSuccess(null);
  };

  const handleRemovePattern = (indexToRemove: number) => {
    setPatterns((current) => current.filter((_, index) => index !== indexToRemove));
    setError(null);
    setSuccess(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/auth/whitelist', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ patterns }),
      });

      const data = await response.json().catch(() => ({} as { error?: string; patterns?: string[] }));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to save whitelist.');
        return;
      }

      setPatterns(Array.isArray(data.patterns) ? data.patterns : []);
      setSuccess('Whitelist saved.');
    } catch {
      setError('Failed to save whitelist.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6f6f8] px-4 py-8 md:px-8 md:py-12 dark:bg-[#0f1117]">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <div className={`${panelClass} p-10`}>
            <div className="flex flex-col items-center gap-3">
              <span className="loading loading-spinner loading-md text-primary" aria-label="Loading" />
              <p className="text-sm text-slate-500 dark:text-slate-400">Loading settings...</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f6f8] px-4 py-8 md:px-8 md:py-12 dark:bg-[#0f1117]">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-4">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              onClick={() => router.push('/')}
              aria-label="Back to home"
            >
              <ChevronRight className="h-6 w-6 rotate-180" />
            </button>
            <h1 className="text-3xl font-black tracking-[-0.02em] text-slate-900 md:text-4xl dark:text-white">Settings</h1>
          </div>
          <p className="ml-14 text-sm text-slate-500 md:text-base dark:text-slate-400">
            Manage global application settings and authentication access control.
          </p>
        </div>

        {flashMessage && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              flashMessage.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-900/30 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-900/30 dark:text-emerald-200'
            }`}
          >
            {flashMessage.text}
          </div>
        )}

        <section className={panelClass}>
          <div className={sectionHeaderClass}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-1.5 text-emerald-600 dark:border dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Email Whitelist</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Manage allowed email patterns for Auth0 magic-link login.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sessionInfo?.enabled ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void handleLogout()}>
                  Sign out
                </button>
              ) : null}
              <button type="button" className={primaryButtonClass} onClick={() => void handleSave()} disabled={saving}>
                {saving ? <span className="loading loading-spinner loading-xs" aria-hidden="true" /> : <KeyRound className="h-4 w-4" />}
                Save whitelist
              </button>
            </div>
          </div>

          <div className="border-b border-slate-100 bg-slate-50/40 px-6 py-4 dark:border-slate-700/50 dark:bg-slate-900/35">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <p><strong>Examples:</strong> <code>*</code> allows all emails, <code>*@sea.com</code> allows sea.com mailboxes, and <code>alice@example.com</code> allows one address.</p>
            {!sessionInfo?.enabled ? (
              <p className="mt-2 text-amber-700 dark:text-amber-300">Auth0 credentials are not configured, so login enforcement is currently disabled.</p>
            ) : null}
            </div>
          </div>

          <div className="space-y-4 p-6">
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleAddPattern}>
              <input
                className={inputClass}
                value={newPattern}
                onChange={(event) => setNewPattern(event.target.value)}
                placeholder="Add pattern, e.g. *@example.com"
              />
              <button type="submit" className={primaryButtonClass} disabled={!normalizedNewPattern}>
                Add pattern
              </button>
            </form>
            {patterns.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No whitelist patterns configured. No email will be allowed.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700/50 dark:border-slate-700/60">
                {patterns.map((pattern, index) => (
                  <div
                    key={`${pattern}-${index}`}
                    className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <code className="truncate text-sm text-slate-700 dark:text-slate-200">{pattern}</code>
                    <button
                      type="button"
                      className={`${rowActionButtonClass} opacity-0 group-hover:opacity-100`}
                      onClick={() => handleRemovePattern(index)}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
