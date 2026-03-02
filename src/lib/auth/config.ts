const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN?.trim() ?? '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID?.trim() ?? '';
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET?.trim() ?? '';
const AUTH0_CALLBACK_URL = process.env.AUTH0_CALLBACK_URL?.trim() ?? '';
const AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET?.trim() ?? '';

export const AUTH_STATE_COOKIE_NAME = 'viba_auth_state';
export const AUTH_NEXT_COOKIE_NAME = 'viba_auth_next';
export const AUTH_SESSION_COOKIE_NAME = 'viba_auth_session';
export const AUTH_STATE_COOKIE_TTL_SECONDS = 10 * 60;
export const AUTH_SESSION_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

function normalizeAuth0Domain(domain: string): string {
  if (!domain) return '';

  const trimmed = domain.replace(/\/+$/g, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getAuth0BaseUrl(): string {
  return normalizeAuth0Domain(AUTH0_DOMAIN);
}

export function isAuthEnabled(): boolean {
  return Boolean(getAuth0BaseUrl() && AUTH0_CLIENT_ID && AUTH0_CLIENT_SECRET);
}

export function getAuth0ClientId(): string {
  return AUTH0_CLIENT_ID;
}

export function getAuth0ClientSecret(): string {
  return AUTH0_CLIENT_SECRET;
}

export function getSessionSecret(): string {
  return AUTH_SESSION_SECRET || AUTH0_CLIENT_SECRET;
}

function resolveBaseUrlFromRequest(request: Request): string {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();

  if (!host) {
    return 'http://localhost:3200';
  }

  const protocol = forwardedProto || (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export function getAuthCallbackUrl(request: Request): string {
  if (AUTH0_CALLBACK_URL) {
    return AUTH0_CALLBACK_URL;
  }

  return `${resolveBaseUrlFromRequest(request)}/api/auth/callback`;
}

export function sanitizeNextPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith('/')) return null;
  if (nextPath.startsWith('//')) return null;
  return nextPath;
}
