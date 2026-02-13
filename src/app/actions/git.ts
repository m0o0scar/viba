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
