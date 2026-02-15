'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';

export type FileSystemItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
};

export type GitBranch = {
  name: string;
  current: boolean;
};

export async function getHomeDirectory() {
  return os.homedir();
}

export async function listDirectories(dirPath: string): Promise<FileSystemItem[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Sort directories first, then files (though we mainly care about directories for repo selection)
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const items: FileSystemItem[] = [];

    for (const entry of sortedEntries) {
      if (!entry.isDirectory()) continue; // Only show directories for repo selection

      const fullPath = path.join(dirPath, entry.name);
      let isGitRepo = false;

      try {
        const gitDir = path.join(fullPath, '.git');
        await fs.access(gitDir);
        isGitRepo = true;
      } catch {
        isGitRepo = false;
      }

      items.push({
        name: entry.name,
        path: fullPath,
        isDirectory: true,
        isGitRepo,
      });
    }

    return items;
  } catch (error) {
    console.error('Error listing directories:', error);
    return [];
  }
}

export async function getBranches(repoPath: string): Promise<GitBranch[]> {
  try {
    const git = simpleGit(repoPath);
    const branchSummary = await git.branchLocal();

    return branchSummary.all.map(name => ({
      name,
      current: branchSummary.current === name,
    }));
  } catch (error) {
    console.error('Error fetching branches:', error);
    throw new Error('Failed to fetch branches. Make sure the path is a valid git repository.');
  }
}

export async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  try {
    const git = simpleGit(repoPath);
    await git.checkout(branchName);
  } catch (error) {
    console.error('Error checking out branch:', error);
    throw new Error(`Failed to checkout branch ${branchName}`);
  }
}

export async function checkIsGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitDir = path.join(dirPath, '.git');
    await fs.access(gitDir);
    return true;
  } catch {
    return false;
  }
}

// Global variable to track the ttyd process
declare global {
  var ttydProcess: ReturnType<typeof import('child_process').spawn> | undefined;
}

export async function startTtydProcess(): Promise<{ success: boolean; error?: string }> {
  if (global.ttydProcess) {
    console.log('ttyd is already running');
    return { success: true };
  }

  try {
    const { spawn } = await import('child_process');
    console.log('Starting ttyd process...');

    // Clean up environment variables to prevent conflicts
    // Specifically remove TURBOPACK which causes "Multiple bundler flags set" error
    // when running next dev inside the terminal if the parent process has it set.
    const env = { ...process.env };
    delete env.TURBOPACK;
    delete env.PORT;

    // Start ttyd with -W (writable) and bash
    const child = spawn('ttyd', [
      '-p', '7681',
      '-t', 'theme={"background": "white", "foreground": "black", "cursor": "black"}',
      '-W', 'bash'
    ], {
      stdio: 'ignore', // or 'pipe' if we want to log output
      detached: false, // Keep attached to parent so it dies when parent dies (mostly)
      env: {
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    child.on('error', (err) => {
      console.error('Failed to start ttyd:', err);
      global.ttydProcess = undefined;
    });

    child.on('exit', (code, signal) => {
      console.log(`ttyd process exited with code ${code} and signal ${signal}`);
      global.ttydProcess = undefined;
    });

    global.ttydProcess = child;

    // Give it a moment to start up
    await new Promise(resolve => setTimeout(resolve, 1000));

    return { success: true };
  } catch (error) {
    console.error('Error starting ttyd:', error);
    return { success: false, error: 'Failed to start ttyd. Make sure ttyd is installed and in your PATH.' };
  }
}

export type SessionMetadata = {
  sessionName: string;
  worktreePath: string;
  branchName: string;
  agent: string;
  model: string;
  title?: string;
  timestamp: string;
};

export async function createSessionWorktree(
  repoPath: string,
  baseBranch: string,
  metadata?: { agent: string; model: string; title?: string }
): Promise<{ success: boolean; sessionName?: string; worktreePath?: string; branchName?: string; error?: string }> {
  try {
    const { v4: uuidv4 } = await import('uuid');
    const shortUuid = uuidv4().split('-')[0]; // first part of uuid enough?

    const date = new Date();
    // YYYYMMDD-HHMM
    const timestamp = date.toISOString().replace(/[-:]/g, '').slice(0, 8) + '-' + date.getHours().toString().padStart(2, '0') + date.getMinutes().toString().padStart(2, '0');
    const sessionName = `${timestamp}-${shortUuid}`;

    const branchName = `viba/${sessionName}`;

    // Parent directory of the repo
    const repoName = path.basename(repoPath);
    const parentDir = path.dirname(repoPath);

    // ../.viba/<repo-name>/<session-name>
    const vibaDir = path.join(parentDir, '.viba', repoName);
    const worktreePath = path.join(vibaDir, sessionName);

    // Ensure .viba directory exists
    await fs.mkdir(vibaDir, { recursive: true });

    const git = simpleGit(repoPath);

    // Create worktree
    // git worktree add -b <new-branch> <path> <start-point>
    console.log(`Creating worktree at ${worktreePath} based on ${baseBranch}`);
    await git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);

    // Save metadata
    if (metadata) {
      const sessionData: SessionMetadata = {
        sessionName,
        worktreePath,
        branchName,
        agent: metadata.agent,
        model: metadata.model,
        title: metadata.title,
        timestamp: date.toISOString(),
      };
      await fs.writeFile(path.join(worktreePath, '.viba-session.json'), JSON.stringify(sessionData, null, 2));
    }

    return {
      success: true,
      sessionName,
      worktreePath,
      branchName
    };
  } catch (e: any) {
    console.error("Failed to create worktree:", e);
    return { success: false, error: e.message || String(e) };
  }
}

export async function listSessions(repoPath: string): Promise<SessionMetadata[]> {
  try {
    const rNa = path.basename(repoPath);
    const pDi = path.dirname(repoPath);
    const vibaDir = path.join(pDi, '.viba', rNa);

    try {
      await fs.access(vibaDir);
    } catch {
      return [];
    }

    const entries = await fs.readdir(vibaDir, { withFileTypes: true });
    const sessions: SessionMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const wtPath = path.join(vibaDir, entry.name);
        // Check for .viba-session.json
        try {
          const metaPath = path.join(wtPath, '.viba-session.json');
          const content = await fs.readFile(metaPath, 'utf-8');
          const data = JSON.parse(content) as SessionMetadata;

          // Verify worktree still exists or is valid? 
          // For now, assume if folder exists, it's a session.
          sessions.push(data);
        } catch {
          // If no metadata, maybe it was created before this update.
          // Or it's a random folder.
          // We can try to infer or skip. Let's skip for now to be safe.
        }
      }
    }

    // Sort by timestamp desc
    return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  } catch (e) {
    console.error("Failed to list sessions:", e);
    return [];
  }
}

// ...existing code...

export async function cleanUpSessionWorktree(repoPath: string, worktreePath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const git = simpleGit(repoPath);

    console.log(`Removing worktree at ${worktreePath}...`);

    // Remove worktree
    // force remove if needed? user might have uncommitted changes but this is a cleanup request.
    // git worktree remove --force <path>
    await git.raw(['worktree', 'remove', '--force', worktreePath]);

    // Remove branch
    // git branch -D <branch>
    console.log(`Deleting branch ${branchName}...`);
    await git.deleteLocalBranch(branchName, true); // true = force delete

    // Try to verify if folder is gone, sometimes worktree remove leaves empty dir
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }

    // New: Clean up attachments folder if exists
    try {
      const attachmentsDir = `${worktreePath}-attachments`;
      await fs.rm(attachmentsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return { success: true };
  } catch (e: any) {
    console.error("Failed to cleanup worktree:", e);
    return { success: false, error: e.message || String(e) };
  }
}

export async function getStartupScript(repoPath: string): Promise<string> {
  try {
    const files = await fs.readdir(repoPath);
    if (files.includes('package-lock.json')) return 'npm install';
    if (files.includes('pnpm-lock.yaml')) return 'pnpm install';
    if (files.includes('yarn.lock')) return 'yarn install';
    return '';
  } catch (error) {
    console.error('Error determining startup script:', error);
    return '';
  }
}

export async function listRepoFiles(repoPath: string, query: string = ''): Promise<string[]> {
  try {
    const git = simpleGit(repoPath);
    const result = await git.raw(['ls-files']);
    const allFiles = result.split('\n').filter(Boolean);

    if (!query) return allFiles.slice(0, 50);

    const lowerQuery = query.toLowerCase();
    return allFiles.filter(f => f.toLowerCase().includes(lowerQuery)).slice(0, 50);
  } catch (error) {
    console.error('Failed to list repo files:', error);
    return [];
  }
}

export async function saveAttachments(worktreePath: string, formData: FormData): Promise<boolean> {
  try {
    const attachmentsDir = `${worktreePath}-attachments`;
    await fs.mkdir(attachmentsDir, { recursive: true });

    const files = Array.from(formData.entries());

    for (const [name, entry] of files) {
      if (entry instanceof File) {
        const buffer = Buffer.from(await entry.arrayBuffer());
        // Sanitize filename
        const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        await fs.writeFile(path.join(attachmentsDir, safeName), buffer);
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to save attachments:', error);
    return false;
  }
}
