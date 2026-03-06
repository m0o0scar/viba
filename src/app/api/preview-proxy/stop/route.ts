import { NextRequest, NextResponse } from 'next/server';

import { stopPreviewProxyServer } from '@/lib/previewProxyServer';

export const runtime = 'nodejs';

type StopPreviewProxyRequestBody = {
  target?: unknown;
};

export async function POST(request: NextRequest) {
  let body: StopPreviewProxyRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  if (!body || typeof body.target !== 'string' || !body.target.trim()) {
    return NextResponse.json({ error: 'target is required' }, { status: 400 });
  }

  try {
    const stopped = await stopPreviewProxyServer(body.target.trim());
    return NextResponse.json({ stopped });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop preview proxy';
    const status = message.toLowerCase().includes('http') ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
