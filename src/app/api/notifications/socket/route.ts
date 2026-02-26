import { NextRequest, NextResponse } from 'next/server';
import {
  buildSessionNotificationWsUrl,
  ensureSessionNotificationServer,
} from '@/lib/sessionNotificationServer';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  try {
    const { wsBaseUrl } = await ensureSessionNotificationServer();
    const wsUrl = buildSessionNotificationWsUrl(wsBaseUrl, sessionId);
    return NextResponse.json({ wsUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize notification socket';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
