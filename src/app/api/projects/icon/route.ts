import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { addProject, getProjects, updateProject } from '@/lib/store';

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ICON_DIR = path.join(os.homedir(), '.viba', 'project-icons');
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);

function sanitizeExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) return null;
  return extension;
}

function findProjectByAbsolutePath(projectPath: string) {
  const normalizedProjectPath = path.resolve(projectPath);
  return getProjects().find((project) => path.resolve(project.path) === normalizedProjectPath) || null;
}

async function ensureProjectExists(projectPath: string) {
  const normalizedProjectPath = path.resolve(projectPath);
  const existingProject = findProjectByAbsolutePath(normalizedProjectPath);
  if (existingProject) return existingProject;

  let projectStats;
  try {
    projectStats = await fs.stat(normalizedProjectPath);
  } catch {
    throw new Error('Project not found.');
  }

  if (!projectStats.isDirectory()) {
    throw new Error('Project path must be a directory.');
  }

  try {
    addProject(normalizedProjectPath, path.basename(normalizedProjectPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/already exists/i.test(message)) {
      throw error;
    }
  }

  const ensuredProject = findProjectByAbsolutePath(normalizedProjectPath);
  if (!ensuredProject) {
    throw new Error('Project not found.');
  }
  return ensuredProject;
}

function getManagedIconPath(projectPath: string, extension: string): string {
  const projectHash = createHash('sha1').update(projectPath).digest('hex').slice(0, 16);
  return path.join(ICON_DIR, `${projectHash}${extension}`);
}

function isManagedIconPath(iconPath: string | null | undefined): boolean {
  if (!iconPath) return false;
  const normalized = path.resolve(iconPath);
  return normalized.startsWith(path.resolve(ICON_DIR) + path.sep) || normalized === path.resolve(ICON_DIR);
}

async function removeExistingManagedIcon(iconPath: string | null | undefined): Promise<void> {
  if (!iconPath || !isManagedIconPath(iconPath)) return;
  try {
    await fs.rm(iconPath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectPathValue = formData.get('projectPath');
    const iconFileValue = formData.get('iconFile');

    if (typeof projectPathValue !== 'string' || !projectPathValue.trim()) {
      return NextResponse.json({ error: 'projectPath is required.' }, { status: 400 });
    }

    if (!(iconFileValue instanceof File)) {
      return NextResponse.json({ error: 'iconFile is required.' }, { status: 400 });
    }

    const extension = sanitizeExtension(iconFileValue.name);
    if (!extension) {
      return NextResponse.json({ error: 'Unsupported icon type. Use png, jpg, jpeg, webp, svg, or ico.' }, { status: 400 });
    }

    if (iconFileValue.size > MAX_ICON_BYTES) {
      return NextResponse.json({ error: 'Icon file must be 2MB or smaller.' }, { status: 400 });
    }

    const projectPath = path.resolve(projectPathValue.trim());
    const existingProject = await ensureProjectExists(projectPath);

    await fs.mkdir(ICON_DIR, { recursive: true });

    const destinationPath = getManagedIconPath(projectPath, extension);
    await removeExistingManagedIcon(existingProject.iconPath);

    const fileBuffer = Buffer.from(await iconFileValue.arrayBuffer());
    await fs.writeFile(destinationPath, fileBuffer);

    const updatedProject = updateProject(existingProject.path, { iconPath: destinationPath });
    return NextResponse.json({ success: true, iconPath: updatedProject.iconPath ?? null });
  } catch (error) {
    const message = (error as Error).message || 'Failed to upload project icon.';
    if (message === 'Project not found.') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === 'Project path must be a directory.') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Failed to upload project icon:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const projectPath = typeof body?.projectPath === 'string' ? body.projectPath.trim() : '';
    if (!projectPath) {
      return NextResponse.json({ error: 'projectPath is required.' }, { status: 400 });
    }

    const normalizedProjectPath = path.resolve(projectPath);
    const existingProject = await ensureProjectExists(normalizedProjectPath);

    await removeExistingManagedIcon(existingProject.iconPath);
    updateProject(existingProject.path, { iconPath: null });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message || 'Failed to remove project icon.';
    if (message === 'Project not found.') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === 'Project path must be a directory.') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Failed to remove project icon:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
