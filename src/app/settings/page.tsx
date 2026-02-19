'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Home, XSquare } from 'lucide-react';
import { CleanupExitBehavior, getConfig, updateConfig } from '@/app/actions/config';

const CLEANUP_EXIT_OPTIONS: Array<{
  value: CleanupExitBehavior;
  title: string;
  description: string;
}> = [
  {
    value: 'back_to_home',
    title: 'Back to home (default)',
    description: 'Clean up the session, then go back to the home page.',
  },
  {
    value: 'close_tab',
    title: 'Close tab',
    description: 'Clean up the session, then close the current tab.',
  },
];

export default function SettingsPage() {
  const [cleanupExitBehavior, setCleanupExitBehavior] = useState<CleanupExitBehavior>('back_to_home');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadConfig = async () => {
      try {
        const config = await getConfig();
        if (active) {
          setCleanupExitBehavior(config.cleanupExitBehavior);
        }
      } catch {
        if (active) {
          setError('Failed to load settings.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      active = false;
    };
  }, []);

  const handleCleanupExitBehaviorChange = async (nextValue: CleanupExitBehavior) => {
    if (nextValue === cleanupExitBehavior) return;

    const previousValue = cleanupExitBehavior;
    setCleanupExitBehavior(nextValue);
    setSaving(true);
    setError(null);

    try {
      await updateConfig({ cleanupExitBehavior: nextValue });
    } catch {
      setCleanupExitBehavior(previousValue);
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-base-100 p-4 md:p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-4">
          <Link href="/" className="btn btn-ghost btn-sm gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>

        <div className="card w-full bg-base-200 shadow-xl">
          <div className="card-body">
            <h1 className="card-title text-2xl">Settings</h1>
            <p className="text-sm opacity-70">
              Configure how session cleanup behaves when you click <span className="font-semibold">Clean Up &amp; Exit</span>.
            </p>

            {error && <div className="alert alert-error text-sm py-2 px-3 mt-2">{error}</div>}

            <section className="mt-4 space-y-3">
              <h2 className="text-sm font-semibold opacity-70 uppercase tracking-wide">Clean Up &amp; Exit Behavior</h2>

              {loading ? (
                <div className="flex items-center justify-center py-8 bg-base-100 rounded-lg border border-base-300">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <div className="space-y-2">
                  {CLEANUP_EXIT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-4 hover:bg-base-300/40"
                    >
                      <input
                        type="radio"
                        className="radio radio-primary mt-1"
                        checked={cleanupExitBehavior === option.value}
                        onChange={() => {
                          void handleCleanupExitBehaviorChange(option.value);
                        }}
                        disabled={saving}
                      />
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {option.value === 'back_to_home' ? (
                            <Home className="w-4 h-4 opacity-70" />
                          ) : (
                            <XSquare className="w-4 h-4 opacity-70" />
                          )}
                          {option.title}
                        </div>
                        <div className="text-xs opacity-60 mt-1">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {saving && (
                <div className="text-xs opacity-60 flex items-center gap-2">
                  <span className="loading loading-spinner loading-xs"></span>
                  Saving...
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
