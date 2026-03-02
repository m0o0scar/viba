import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_SESSION_COOKIE_NAME,
  getSessionSecret,
  isAuthEnabled,
  sanitizeNextPath,
} from '@/lib/auth/config';
import { verifyAuthSessionTokenEdge } from '@/lib/auth/session-token-edge';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (/\.[^/]+$/.test(pathname)) return true;
  return false;
}

function buildLoginRedirectUrl(request: NextRequest): URL {
  const loginUrl = new URL('/login', request.url);
  const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (nextPath) {
    loginUrl.searchParams.set('next', nextPath);
  }
  return loginUrl;
}

export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    return NextResponse.redirect(buildLoginRedirectUrl(request));
  }

  const payload = await verifyAuthSessionTokenEdge(token, getSessionSecret());
  if (payload) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const response = NextResponse.redirect(buildLoginRedirectUrl(request));
  response.cookies.delete(AUTH_SESSION_COOKIE_NAME);
  return response;
}

export const config = {
  matcher: '/:path*',
};
