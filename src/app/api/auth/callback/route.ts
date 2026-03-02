import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_NEXT_COOKIE_NAME,
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_COOKIE_TTL_SECONDS,
  AUTH_STATE_COOKIE_NAME,
  getAuth0BaseUrl,
  getAuth0ClientId,
  getAuth0ClientSecret,
  getAuthCallbackUrl,
  getSessionSecret,
  isAuthEnabled,
  sanitizeNextPath,
} from '@/lib/auth/config';
import { isEmailWhitelisted } from '@/lib/auth/email-whitelist';
import { createAuthSessionToken } from '@/lib/auth/session-token';

type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

function shouldUseSecureCookies(request: NextRequest): boolean {
  return request.url.startsWith('https://') || process.env.NODE_ENV === 'production';
}

function redirectToLogin(request: NextRequest, errorCode: string): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', errorCode);
  return NextResponse.redirect(url);
}

function decodeEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;

  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { email?: unknown };

    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

async function resolveEmailFromAuth0(auth0BaseUrl: string, tokenResponse: TokenResponse): Promise<string | null> {
  if (tokenResponse.access_token) {
    try {
      const userInfoResponse = await fetch(`${auth0BaseUrl}/userinfo`, {
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
        },
      });

      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json() as { email?: unknown };
        if (typeof userInfo.email === 'string' && userInfo.email.trim()) {
          return userInfo.email.trim();
        }
      }
    } catch {
      // Fallback to id_token decoding below.
    }
  }

  return decodeEmailFromIdToken(tokenResponse.id_token);
}

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = request.cookies.get(AUTH_STATE_COOKIE_NAME)?.value;

  if (error) {
    const response = redirectToLogin(request, 'auth0_error');
    response.cookies.delete(AUTH_STATE_COOKIE_NAME);
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
    return response;
  }

  if (!code || !state || !stateCookie || stateCookie !== state) {
    const response = redirectToLogin(request, 'invalid_state');
    response.cookies.delete(AUTH_STATE_COOKIE_NAME);
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
    return response;
  }

  const tokenExchangeResponse = await fetch(`${getAuth0BaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: getAuth0ClientId(),
      client_secret: getAuth0ClientSecret(),
      code,
      redirect_uri: getAuthCallbackUrl(request),
    }),
  });

  if (!tokenExchangeResponse.ok) {
    const response = redirectToLogin(request, 'token_exchange_failed');
    response.cookies.delete(AUTH_STATE_COOKIE_NAME);
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
    return response;
  }

  const tokenResponse = await tokenExchangeResponse.json() as TokenResponse;
  const email = (await resolveEmailFromAuth0(getAuth0BaseUrl(), tokenResponse))?.trim().toLowerCase() ?? null;

  if (!email) {
    const response = redirectToLogin(request, 'email_not_found');
    response.cookies.delete(AUTH_STATE_COOKIE_NAME);
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
    return response;
  }

  if (!(await isEmailWhitelisted(email))) {
    const response = redirectToLogin(request, 'not_whitelisted');
    response.cookies.delete(AUTH_STATE_COOKIE_NAME);
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
    return response;
  }

  const nextPath = sanitizeNextPath(request.cookies.get(AUTH_NEXT_COOKIE_NAME)?.value) || '/';

  const sessionToken = createAuthSessionToken(email, getSessionSecret(), AUTH_SESSION_COOKIE_TTL_SECONDS);

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.cookies.delete(AUTH_STATE_COOKIE_NAME);
  response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
  response.cookies.set(AUTH_SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    maxAge: AUTH_SESSION_COOKIE_TTL_SECONDS,
    path: '/',
  });

  return response;
}
