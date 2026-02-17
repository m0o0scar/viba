import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Metadata } from 'next';
import SessionPageClient from './SessionPageClient';

type SessionRouteProps = {
  params: Promise<{ sessionId: string }>;
};

type SessionFileData = {
  title?: string;
};

async function readSessionTitle(sessionId: string): Promise<string | undefined> {
  try {
    const sessionFilePath = path.join(os.homedir(), '.viba', 'sessions', `${sessionId}.json`);
    const rawContent = await fs.readFile(sessionFilePath, 'utf-8');
    const data = JSON.parse(rawContent) as SessionFileData;

    const trimmedTitle = data.title?.trim();
    return trimmedTitle || undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: SessionRouteProps): Promise<Metadata> {
  const { sessionId } = await params;
  const sessionTitle = await readSessionTitle(sessionId);

  if (!sessionTitle) {
    return {};
  }

  return {
    title: sessionTitle,
  };
}

export default function SessionPage() {
  return <SessionPageClient />;
}
