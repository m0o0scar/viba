import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

type ResolveComponentSourceRequestBody = {
  componentName?: unknown;
  workspaceRoot?: unknown;
};

const SEARCH_GLOBS = [
  '!**/node_modules/**',
  '!**/.git/**',
  '!**/.next/**',
  '!**/dist/**',
  '!**/build/**',
  '!**/coverage/**',
  '*.{ts,tsx,js,jsx,mjs,cjs}',
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();

const unique = (items: string[]): string[] => Array.from(new Set(items));

const buildSearchPatterns = (componentName: string): string[] => {
  const escaped = escapeRegex(componentName);

  return [
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`,
    `\\b(?:async\\s+)?function\\s+${escaped}\\b`,
    `\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`,
    `\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?[A-Za-z_$][\\w$]*\\s*=>`,
    `\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:memo|forwardRef)\\s*\\(`,
    `\\bexport\\s+default\\s+${escaped}\\b`,
    `\\bclass\\s+${escaped}\\b`,
  ];
};

const buildRgArgs = (pattern: string): string[] => {
  const args = [
    '-l',
    '--no-messages',
    '--pcre2',
  ];

  for (const glob of SEARCH_GLOBS) {
    args.push('--glob', glob);
  }

  args.push(pattern, '.');
  return args;
};

const runPatternSearch = async (workspaceRoot: string, pattern: string): Promise<string[]> => {
  try {
    const { stdout } = await execFileAsync('rg', buildRgArgs(pattern), {
      cwd: workspaceRoot,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 5000,
    });

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const scoreCandidate = (candidatePath: string, componentName: string): number => {
  const normalized = candidatePath.replace(/\\/g, '/').toLowerCase();
  const kebabName = toKebabCase(componentName);
  const fileName = path.basename(normalized);

  let score = 0;
  if (normalized.includes('/src/components/')) score += 100;
  if (normalized.includes('/components/')) score += 80;
  if (normalized.includes('/src/')) score += 60;
  if (/\.(tsx|jsx)$/.test(normalized)) score += 20;
  if (fileName.includes(kebabName)) score += 15;
  if (fileName.includes(componentName.toLowerCase())) score += 10;
  if (normalized.includes('/node_modules/')) score -= 1000;

  return score;
};

const pickBestCandidate = (workspaceRoot: string, componentName: string, relativePaths: string[]): string | null => {
  const absoluteCandidates = unique(relativePaths)
    .map((relativePath) => path.resolve(workspaceRoot, relativePath))
    .filter(Boolean);

  if (absoluteCandidates.length === 0) return null;

  const sorted = absoluteCandidates.sort((a, b) => {
    const scoreDiff = scoreCandidate(b, componentName) - scoreCandidate(a, componentName);
    if (scoreDiff !== 0) return scoreDiff;
    return a.length - b.length;
  });

  return sorted[0] || null;
};

const resolveSourcePathByComponentName = async (
  workspaceRoot: string,
  componentName: string
): Promise<string | null> => {
  const patterns = buildSearchPatterns(componentName);
  let candidates: string[] = [];

  for (const pattern of patterns) {
    const matches = await runPatternSearch(workspaceRoot, pattern);
    if (matches.length > 0) {
      candidates = matches;
      break;
    }
  }

  const best = pickBestCandidate(workspaceRoot, componentName, candidates);
  return best;
};

export async function POST(request: NextRequest) {
  let body: ResolveComponentSourceRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const componentName = typeof body.componentName === 'string' ? body.componentName.trim() : '';
  const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot.trim() : '';

  if (!componentName) {
    return NextResponse.json({ error: 'componentName is required' }, { status: 400 });
  }

  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    return NextResponse.json({ error: 'workspaceRoot must be an absolute path' }, { status: 400 });
  }

  try {
    const stat = await fs.stat(workspaceRoot);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'workspaceRoot must be a directory' }, { status: 400 });
    }

    const sourcePath = await resolveSourcePathByComponentName(workspaceRoot, componentName);

    if (!sourcePath) {
      return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    }

    return NextResponse.json({ sourcePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve component source';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
