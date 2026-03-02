import { NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/config';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(AUTH_SESSION_COOKIE_NAME);
  return response;
}
