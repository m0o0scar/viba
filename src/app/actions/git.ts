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

export async function listPathEntries(dirPath: string): Promise<FileSystemItem[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const items: FileSystemItem[] = [];

    for (const entry of sortedEntries) {
      if (!entry.isDirectory() && !entry.isFile()) continue;

      const fullPath = path.join(dirPath, entry.name);
      let isGitRepo = false;

      if (entry.isDirectory()) {
        try {
          const gitDir = path.join(fullPath, '.git');
          await fs.access(gitDir);
          isGitRepo = true;
        } catch {
          isGitRepo = false;
        }
      }

      items.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isGitRepo,
      });
    }

    return items;
  } catch (error) {
    console.error('Error listing directory entries:', error);
    return [];
  }
}

export async function listDirectories(dirPath: string): Promise<FileSystemItem[]> {
  const items = await listPathEntries(dirPath);
  return items.filter((item) => item.isDirectory);
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

    const env: any = { ...process.env };
    // Clean up environment variables to prevent conflicts
    // Specifically remove TURBOPACK which causes "Multiple bundler flags set" error
    // when running next dev inside the terminal if the parent process has it set.
    delete env.TURBOPACK;
    delete env.PORT;
    delete env.NODE_ENV;

    const shell = os.platform() === 'win32' ? 'powershell' : 'bash';
    const workingDir = os.homedir();

    const child = spawn('ttyd', [
      '-p', '7681',
      '-t', 'theme={"background": "white", "foreground": "black", "cursor": "black", "selectionBackground": "rgba(59, 130, 246, 0.4)"}',
      '-t', 'disableResizeOverlay=true',
      '-t', 'fontSize=12',
      '-t', 'fontWeight=300',
      '-t', 'fontWeightBold=500',
      '-w', workingDir,
      '-W', shell
    ], {
      stdio: 'ignore',
      detached: false,
      cwd: workingDir,
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

    await new Promise(resolve => setTimeout(resolve, 1000));

    return { success: true };
  } catch (error) {
    console.error('Error starting ttyd:', error);
    return { success: false, error: 'Failed to start ttyd. Make sure ttyd is installed and in your PATH.' };
  }
}

export async function prepareSessionWorktree(
  repoPath: string,
  baseBranch: string
): Promise<{ success: boolean; sessionName?: string; worktreePath?: string; branchName?: string; error?: string }> {
  try {
    const { v4: uuidv4 } = await import('uuid');
    const shortUuid = uuidv4().split('-')[0];

    const date = new Date();
    const timestamp = date.toISOString().replace(/[-:]/g, '').slice(0, 8) + '-' + date.getHours().toString().padStart(2, '0') + date.getMinutes().toString().padStart(2, '0');
    const sessionName = `${timestamp}-${shortUuid}`;

    const branchName = `viba/${sessionName}`;

    const repoName = path.basename(repoPath);
    const parentDir = path.dirname(repoPath);

    const vibaDir = path.join(parentDir, '.viba', repoName);
    const worktreePath = path.join(vibaDir, sessionName);

    await fs.mkdir(vibaDir, { recursive: true });

    const git = simpleGit(repoPath);

    console.log(`Creating worktree at ${worktreePath} based on ${baseBranch}`);
    await git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);

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

export async function removeWorktree(repoPath: string, worktreePath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const git = simpleGit(repoPath);

    console.log(`Removing worktree at ${worktreePath}...`);
    try {
      await git.raw(['worktree', 'remove', '--force', worktreePath]);
    } catch (e: any) {
      const errorMsg = e.message || String(e);
      if (errorMsg.includes('is not a working tree') || errorMsg.includes('not a valid path')) {
        console.warn(`Path ${worktreePath} is not a valid working tree according to git, continuing cleanup...`);
      } else {
        console.error(`Git worktree remove failed, but continuing with cleanup: ${errorMsg}`);
      }

      // Try to prune in case of stale worktree metadata
      try {
        await git.raw(['worktree', 'prune']);
      } catch {
        // ignore prune errors
      }
    }

    console.log(`Deleting branch ${branchName}...`);
    try {
      await git.deleteLocalBranch(branchName, true);
    } catch (e: any) {
      console.warn(`Failed to delete branch ${branchName}: ${e.message || e}`);
    }

    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      // ignore
    }

    try {
      const attachmentsDir = `${worktreePath}-attachments`;
      await fs.rm(attachmentsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return { success: true };
  } catch (e: any) {
    console.error("Failed to cleanup worktree (critical error):", e);
    // Even on critical error, return success: true if we want the session to be considered "deleted"
    // so the metadata can be removed.
    return { success: true };
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

export async function saveAttachments(worktreePath: string, formData: FormData): Promise<string[]> {
  try {
    const attachmentsDir = `${worktreePath}-attachments`;
    await fs.mkdir(attachmentsDir, { recursive: true });

    const savedNames: string[] = [];
    const files = Array.from(formData.entries());

    for (const [, entry] of files) {
      if (entry instanceof File) {
        const buffer = Buffer.from(await entry.arrayBuffer());
        const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fullPath = path.join(attachmentsDir, safeName);
        await fs.writeFile(fullPath, buffer);
        savedNames.push(safeName);
      }
    }
    return savedNames;
  } catch (error) {
    console.error('Failed to save attachments:', error);
    return [];
  }
}
