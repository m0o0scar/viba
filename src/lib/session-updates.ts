export const SESSIONS_UPDATED_STORAGE_KEY = 'viba:sessions-updated-at';
export const SESSIONS_UPDATED_EVENT = 'viba:sessions-updated';

export function notifySessionsUpdated(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(SESSIONS_UPDATED_STORAGE_KEY, new Date().toISOString());
  } catch {
    // Ignore localStorage failures (private mode, quota, etc.)
  }

  window.dispatchEvent(new CustomEvent(SESSIONS_UPDATED_EVENT));
}
