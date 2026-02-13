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

    // Start ttyd with -W (writable) and bash
    const child = spawn('ttyd', ['-p', '7681', '-W', 'bash'], {
      stdio: 'ignore', // or 'pipe' if we want to log output
      detached: false, // Keep attached to parent so it dies when parent dies (mostly)
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
