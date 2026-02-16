'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { prepareSessionWorktree, removeWorktree } from './git';

export type SessionMetadata = {
  sessionName: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  agent: string;
  model: string;
  title?: string;
  devServerScript?: string;
  timestamp: string;
};

async function getSessionsDir(): Promise<string> {
  const homedir = os.homedir();
  const sessionsDir = path.join(homedir, '.viba', 'sessions');
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
  } catch (error) {
    // Ignore if exists
  }
  return sessionsDir;
}

export async function saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const sessionsDir = await getSessionsDir();
  const filePath = path.join(sessionsDir, `${metadata.sessionName}.json`);
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function getSessionMetadata(sessionName: string): Promise<SessionMetadata | null> {
  try {
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionName}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

export async function listSessions(repoPath?: string): Promise<SessionMetadata[]> {
  try {
    const sessionsDir = await getSessionsDir();
    const entries = await fs.readdir(sessionsDir);
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;

      try {
        const filePath = path.join(sessionsDir, entry);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as SessionMetadata;

        // Filter by repoPath if provided
        if (repoPath && data.repoPath !== repoPath) {
            continue;
        }

        sessions.push(data);
      } catch (e) {
        console.error(`Failed to parse session file ${entry}:`, e);
      }
    }

    // Sort by timestamp desc
    return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.error('Failed to list sessions:', error);
    return [];
  }
}

export async function createSession(
  repoPath: string,
  baseBranch: string,
  metadata: { agent: string; model: string; title?: string; devServerScript?: string }
): Promise<{ success: boolean; sessionName?: string; worktreePath?: string; branchName?: string; error?: string }> {
  try {
    // 1. Prepare worktree
    const result = await prepareSessionWorktree(repoPath, baseBranch);

    if (!result.success || !result.sessionName || !result.worktreePath || !result.branchName) {
      return result;
    }

    // 2. Save metadata
    const sessionData: SessionMetadata = {
      sessionName: result.sessionName,
      repoPath,
      worktreePath: result.worktreePath,
      branchName: result.branchName,
      agent: metadata.agent,
      model: metadata.model,
      title: metadata.title,
      devServerScript: metadata.devServerScript,
      timestamp: new Date().toISOString(),
    };

    await saveSessionMetadata(sessionData);

    return result;
  } catch (e: any) {
    console.error("Failed to create session:", e);
    return { success: false, error: e.message || String(e) };
  }
}

export async function deleteSession(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    // 1. Remove worktree
    const result = await removeWorktree(metadata.repoPath, metadata.worktreePath, metadata.branchName);
    if (!result.success) {
      return result;
    }

    // 2. Delete metadata file
    const sessionsDir = await getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionName}.json`);
    await fs.rm(filePath, { force: true });

    return { success: true };
  } catch (e: any) {
    console.error("Failed to delete session:", e);
    return { success: false, error: e.message || String(e) };
  }
}
