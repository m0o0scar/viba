import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_SESSION_COOKIE_NAME,
  getSessionSecret,
  isAuthEnabled,
} from '@/lib/auth/config';
import { verifyAuthSessionToken } from '@/lib/auth/session-token';

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false, authenticated: true, email: null });
  }

  const sessionToken = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ enabled: true, authenticated: false, email: null });
  }

  const payload = verifyAuthSessionToken(sessionToken, getSessionSecret());
  if (!payload) {
    return NextResponse.json({ enabled: true, authenticated: false, email: null });
  }

  return NextResponse.json({ enabled: true, authenticated: true, email: payload.email });
}
