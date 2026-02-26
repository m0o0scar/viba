import { NextRequest, NextResponse } from 'next/server';
import { publishSessionNotification } from '@/lib/sessionNotificationServer';

export const runtime = 'nodejs';

type NotificationRequestBody = {
  sessionId?: unknown;
  title?: unknown;
  description?: unknown;
};

const readRequiredString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export async function POST(request: NextRequest) {
  let body: NotificationRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const sessionId = readRequiredString(body.sessionId);
  const title = readRequiredString(body.title);
  const description = readRequiredString(body.description);
  if (!sessionId || !title || !description) {
    return NextResponse.json(
      { error: 'sessionId, title, and description are required' },
      { status: 400 }
    );
  }

  try {
    const delivered = await publishSessionNotification({ sessionId, title, description });
    return NextResponse.json({ success: true, delivered });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send notification';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
