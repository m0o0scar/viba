import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readEmailWhitelistPatterns, saveEmailWhitelistPatterns } from '@/lib/auth/email-whitelist';

const updateSchema = z.object({
  patterns: z.array(z.string()),
});

export async function GET() {
  const patterns = await readEmailWhitelistPatterns();
  return NextResponse.json({ patterns });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = updateSchema.parse(body);
    const patterns = await saveEmailWhitelistPatterns(parsed.patterns);
    return NextResponse.json({ patterns });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to save whitelist patterns.' }, { status: 500 });
  }
}
