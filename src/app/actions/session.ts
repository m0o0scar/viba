'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { allPortsWithPid } from 'pid-port';
import simpleGit from 'simple-git';
import { prepareSessionWorktree, removeWorktree } from './git';

export type SessionMetadata = {
  sessionName: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseBranch?: string;
  agent: string;
  model: string;
  title?: string;
  devServerScript?: string;
  initialized?: boolean;
  timestamp: string;
};

export type SessionLaunchContext = {
  sessionName: string;
  title?: string;
  initialMessage?: string;
  rawInitialMessage?: string;
  startupScript?: string;
  attachmentNames?: string[];
  agentProvider?: string;
  model?: string;
  isResume?: boolean;
  timestamp: string;
};

export type SessionPrefillContext = {
  sourceSessionName: string;
  repoPath: string;
  title?: string;
  initialMessage?: string;
  attachmentNames: string[];
  agentProvider: string;
  model: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const PREFERRED_DEV_SERVER_PORTS = [3000, 3001, 5173, 4173, 8080, 4200, 8000];

async function runCommand(command: string, args: string[]): Promise<string> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function parsePortFromLsofAddress(address: string): number | undefined {
  const match = address.match(/:(\d+)(?:->|$)/);
  if (!match) return undefined;

  const parsed = Number.parseInt(match[1], 10);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

async function getProcessWorkingDirectory(pid: number): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined;

  try {
    const output = await runCommand('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n'));
    const cwd = cwdLine?.slice(1).trim();
    return cwd || undefined;
  } catch {
    return undefined;
  }
}

async function getListeningTcpPorts(pid: number): Promise<number[]> {
  if (process.platform === 'win32') return [];

  try {
    const output = await runCommand('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn']);
    const uniquePorts = new Set<number>();

    for (const line of output.split('\n')) {
      if (!line.startsWith('n')) continue;
      const parsed = parsePortFromLsofAddress(line.slice(1).trim());
      if (typeof parsed === 'number') {
        uniquePorts.add(parsed);
      }
    }

    return [...uniquePorts];
  } catch {
    return [];
  }
}

function isWithinWorktree(cwd: string | undefined, worktreePath: string): boolean {
  if (!cwd) return false;

  const normalizedCwd = path.resolve(cwd);
  const normalizedWorktree = path.resolve(worktreePath);
  return normalizedCwd === normalizedWorktree || normalizedCwd.startsWith(`${normalizedWorktree}${path.sep}`);
}

function selectDevServerPort(ports: number[]): number | undefined {
  const deduped = Array.from(
    new Set(
      ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
    )
  );

  if (deduped.length === 0) {
    return undefined;
  }

  const preferenceIndex = new Map<number, number>(
    PREFERRED_DEV_SERVER_PORTS.map((port, index) => [port, index])
  );

  deduped.sort((left, right) => {
    const leftRank = preferenceIndex.get(left) ?? 10_000 + left;
    const rightRank = preferenceIndex.get(right) ?? 10_000 + right;
    return leftRank - rightRank;
  });

  return deduped[0];
}

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

async function getSessionContextsDir(): Promise<string> {
  const homedir = os.homedir();
  const contextsDir = path.join(homedir, '.viba', 'session-contexts');
  try {
    await fs.mkdir(contextsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return contextsDir;
}

async function getSessionContextFilePath(sessionName: string): Promise<string> {
  const contextsDir = await getSessionContextsDir();
  return path.join(contextsDir, `${sessionName}.json`);
}

export async function saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
  const sessionsDir = await getSessionsDir();
  const filePath = path.join(sessionsDir, `${metadata.sessionName}.json`);
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function saveSessionLaunchContext(
  sessionName: string,
  context: Omit<SessionLaunchContext, 'sessionName' | 'timestamp'>
): Promise<{ success: boolean; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const contextData: SessionLaunchContext = {
      sessionName,
      ...context,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(contextData, null, 2), 'utf-8');
    return { success: true };
  } catch (e: unknown) {
    console.error('Failed to save session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function consumeSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const content = await fs.readFile(filePath, 'utf-8');
    const context = JSON.parse(content) as SessionLaunchContext;
    return { success: true, context };
  } catch (e: unknown) {
    const errorCode =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: string }).code
        : undefined;
    if (errorCode === 'ENOENT') {
      return { success: true };
    }
    console.error('Failed to consume session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

async function getSessionLaunchContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionLaunchContext; error?: string }> {
  try {
    const filePath = await getSessionContextFilePath(sessionName);
    const content = await fs.readFile(filePath, 'utf-8');
    const context = JSON.parse(content) as SessionLaunchContext;
    return { success: true, context };
  } catch (e: unknown) {
    const errorCode =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code?: string }).code
        : undefined;
    if (errorCode === 'ENOENT') {
      return { success: true };
    }
    console.error('Failed to read session launch context:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionPrefillContext(
  sessionName: string
): Promise<{ success: boolean; context?: SessionPrefillContext; error?: string }> {
  const metadata = await getSessionMetadata(sessionName);
  if (!metadata) {
    return { success: false, error: 'Session metadata not found' };
  }

  const launchContextResult = await getSessionLaunchContext(sessionName);
  if (!launchContextResult.success) {
    return { success: false, error: launchContextResult.error || 'Failed to load session launch context' };
  }

  const launchContext = launchContextResult.context;
  const prefill: SessionPrefillContext = {
    sourceSessionName: sessionName,
    repoPath: metadata.repoPath,
    title: launchContext?.title || metadata.title,
    initialMessage: launchContext?.rawInitialMessage || launchContext?.initialMessage,
    attachmentNames: launchContext?.attachmentNames || [],
    agentProvider: launchContext?.agentProvider || metadata.agent,
    model: launchContext?.model || metadata.model,
  };

  return { success: true, context: prefill };
}

export async function copySessionAttachments(
  sourceSessionName: string,
  targetWorktreePath: string,
  requestedAttachmentNames: string[]
): Promise<{ success: boolean; copiedAttachmentNames: string[]; missingAttachmentNames: string[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sourceSessionName);
    if (!metadata) {
      return {
        success: false,
        copiedAttachmentNames: [],
        missingAttachmentNames: [],
        error: 'Source session metadata not found',
      };
    }

    const sourceAttachmentsDir = `${metadata.worktreePath}-attachments`;
    const targetAttachmentsDir = `${targetWorktreePath}-attachments`;
    await fs.mkdir(targetAttachmentsDir, { recursive: true });

    const copiedAttachmentNames: string[] = [];
    const missingAttachmentNames: string[] = [];
    const dedupedRequestedNames = Array.from(
      new Set(requestedAttachmentNames.map((name) => name.trim()).filter(Boolean))
    );

    for (const name of dedupedRequestedNames) {
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const sourcePath = path.join(sourceAttachmentsDir, safeName);
      const targetPath = path.join(targetAttachmentsDir, safeName);

      try {
        await fs.copyFile(sourcePath, targetPath);
        copiedAttachmentNames.push(safeName);
      } catch (e: unknown) {
        const errorCode =
          typeof e === 'object' && e !== null && 'code' in e
            ? (e as { code?: string }).code
            : undefined;

        if (errorCode === 'ENOENT') {
          missingAttachmentNames.push(name);
          continue;
        }

        throw e;
      }
    }

    return { success: true, copiedAttachmentNames, missingAttachmentNames };
  } catch (e: unknown) {
    console.error('Failed to copy session attachments:', e);
    return {
      success: false,
      copiedAttachmentNames: [],
      missingAttachmentNames: [],
      error: getErrorMessage(e),
    };
  }
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
      baseBranch,
      agent: metadata.agent,
      model: metadata.model,
      title: metadata.title,
      devServerScript: metadata.devServerScript,
      initialized: false,
      timestamp: new Date().toISOString(),
    };

    await saveSessionMetadata(sessionData);

    return result;
  } catch (e: unknown) {
    console.error("Failed to create session:", e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function markSessionInitialized(sessionName: string): Promise<void> {
  const metadata = await getSessionMetadata(sessionName);
  if (!metadata) return;
  if (metadata.initialized) return;

  metadata.initialized = true;
  await saveSessionMetadata(metadata);
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
    const contextFilePath = await getSessionContextFilePath(sessionName);
    await fs.rm(contextFilePath, { force: true });

    return { success: true };
  } catch (e: unknown) {
    console.error("Failed to delete session:", e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function deleteSessionInBackground(sessionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    // Resolve only after cleanup completes so callers can refresh session lists accurately.
    return await deleteSession(sessionName);
  } catch (e: unknown) {
    console.error('Failed to schedule background session deletion:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function mergeSessionToBase(
  sessionName: string
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return {
        success: false,
        error: 'Base branch is missing for this session. This session may be from an older version.',
      };
    }

    const worktreeGit = simpleGit(metadata.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return {
        success: false,
        error: 'Worktree has uncommitted changes. Commit your changes first.',
      };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const originalBranch = branchSummary.current;
    if (originalBranch !== baseBranch) {
      await git.checkout(baseBranch);
    }

    // Always create a merge commit record instead of fast-forwarding.
    await git.merge(['--no-ff', metadata.branchName]);

    if (originalBranch && originalBranch !== baseBranch) {
      await git.checkout(originalBranch);
    }

    return {
      success: true,
      branchName: metadata.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to merge session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function rebaseSessionOntoBase(
  sessionName: string
): Promise<{ success: boolean; branchName?: string; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return {
        success: false,
        error: 'Base branch is missing for this session. This session may be from an older version.',
      };
    }

    const worktreeGit = simpleGit(metadata.worktreePath);
    const worktreeStatus = await worktreeGit.status();
    if (!worktreeStatus.isClean()) {
      return {
        success: false,
        error: 'Worktree has uncommitted changes. Commit your changes first.',
      };
    }

    const repoGit = simpleGit(metadata.repoPath);
    const branchSummary = await repoGit.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const worktreeBranchSummary = await worktreeGit.branchLocal();
    if (worktreeBranchSummary.current !== metadata.branchName) {
      await worktreeGit.checkout(metadata.branchName);
    }

    await worktreeGit.rebase([baseBranch]);

    return {
      success: true,
      branchName: metadata.branchName,
      baseBranch,
    };
  } catch (e: unknown) {
    console.error('Failed to rebase session branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionUncommittedFileCount(
  sessionName: string
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const git = simpleGit(metadata.worktreePath);
    const status = await git.status();

    return { success: true, count: status.files.length };
  } catch (e: unknown) {
    console.error('Failed to get uncommitted file count:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function getSessionDivergence(
  sessionName: string
): Promise<{ success: boolean; ahead?: number; behind?: number; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const baseBranch = metadata.baseBranch?.trim();
    if (!baseBranch) {
      return { success: false, error: 'Base branch is unavailable for this session.' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(baseBranch)) {
      return { success: false, error: `Base branch "${baseBranch}" not found in repository.` };
    }
    if (!branchSummary.all.includes(metadata.branchName)) {
      return { success: false, error: `Session branch "${metadata.branchName}" not found in repository.` };
    }

    const rawCounts = await git.raw(['rev-list', '--left-right', '--count', `${baseBranch}...${metadata.branchName}`]);
    const [behindRaw, aheadRaw] = rawCounts.trim().split(/\s+/);
    const behind = Number.parseInt(behindRaw, 10);
    const ahead = Number.parseInt(aheadRaw, 10);

    if (Number.isNaN(behind) || Number.isNaN(ahead)) {
      return { success: false, error: 'Failed to parse git divergence output.' };
    }

    return { success: true, ahead, behind };
  } catch (e: unknown) {
    console.error('Failed to get session divergence:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function listSessionBaseBranches(
  sessionName: string
): Promise<{ success: boolean; baseBranch?: string; branches?: string[]; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    const branches = [...branchSummary.all].sort((a, b) => a.localeCompare(b));
    const baseBranch = metadata.baseBranch?.trim();

    return { success: true, baseBranch, branches };
  } catch (e: unknown) {
    console.error('Failed to list session base branches:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function detectSessionDevServerUrl(
  sessionName: string
): Promise<{ success: boolean; port?: number; url?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const portsWithPid = await allPortsWithPid();
    const pidCandidates = new Set<number>();

    for (const [port, pid] of portsWithPid) {
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue;
      if (port <= 0 || port >= 65536) continue;
      pidCandidates.add(pid);
    }

    if (pidCandidates.size === 0) {
      return { success: false, error: 'No listening processes found' };
    }

    const allCandidatePorts: number[] = [];

    for (const pid of pidCandidates) {
      const cwd = await getProcessWorkingDirectory(pid);
      if (!isWithinWorktree(cwd, metadata.worktreePath)) {
        continue;
      }

      const listeningPorts = await getListeningTcpPorts(pid);
      if (listeningPorts.length > 0) {
        allCandidatePorts.push(...listeningPorts);
      }
    }

    const selectedPort = selectDevServerPort(allCandidatePorts);
    if (!selectedPort) {
      return { success: false, error: 'No dev server port found yet' };
    }

    return {
      success: true,
      port: selectedPort,
      url: `http://127.0.0.1:${selectedPort}`,
    };
  } catch (e: unknown) {
    console.error('Failed to detect session dev server URL:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}

export async function updateSessionBaseBranch(
  sessionName: string,
  baseBranch: string
): Promise<{ success: boolean; baseBranch?: string; error?: string }> {
  try {
    const metadata = await getSessionMetadata(sessionName);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    const nextBaseBranch = baseBranch.trim();
    if (!nextBaseBranch) {
      return { success: false, error: 'Base branch cannot be empty.' };
    }

    const git = simpleGit(metadata.repoPath);
    const branchSummary = await git.branchLocal();
    if (!branchSummary.all.includes(nextBaseBranch)) {
      return { success: false, error: `Base branch "${nextBaseBranch}" not found in repository.` };
    }

    metadata.baseBranch = nextBaseBranch;
    await saveSessionMetadata(metadata);

    return { success: true, baseBranch: nextBaseBranch };
  } catch (e: unknown) {
    console.error('Failed to update session base branch:', e);
    return { success: false, error: getErrorMessage(e) };
  }
}
