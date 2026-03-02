import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppDataDir } from '../platform-utils.ts';

const WHITELIST_FILE_NAME = 'email-whitelist.json';
const DEFAULT_WHITELIST = ['*'];

function getWhitelistFilePath(): string {
  return path.join(getAppDataDir(), WHITELIST_FILE_NAME);
}

type WhitelistFile = {
  patterns?: unknown;
};

function normalizePattern(pattern: string): string {
  return pattern.trim();
}

function sanitizePatterns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const deduped = new Set<string>();
  const output: string[] = [];

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const normalized = normalizePattern(item);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (deduped.has(key)) continue;

    deduped.add(key);
    output.push(normalized);
  }

  return output;
}

async function ensureWhitelistExists(): Promise<void> {
  const filePath = getWhitelistFilePath();

  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ patterns: DEFAULT_WHITELIST }, null, 2), 'utf8');
  }
}

export async function readEmailWhitelistPatterns(): Promise<string[]> {
  await ensureWhitelistExists();

  try {
    const content = await fs.readFile(getWhitelistFilePath(), 'utf8');
    const parsed = JSON.parse(content) as WhitelistFile;
    return sanitizePatterns(parsed.patterns);
  } catch (error) {
    console.error('Failed to read email whitelist:', error);
    return [...DEFAULT_WHITELIST];
  }
}

export async function saveEmailWhitelistPatterns(patterns: string[]): Promise<string[]> {
  const sanitized = sanitizePatterns(patterns);
  await fs.mkdir(getAppDataDir(), { recursive: true });
  await fs.writeFile(
    getWhitelistFilePath(),
    JSON.stringify({ patterns: sanitized }, null, 2),
    'utf8',
  );

  return sanitized;
}

function escapeRegexSpecialChars(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
  const escaped = escapeRegexSpecialChars(pattern).replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function isEmailAllowedByPatterns(email: string, patterns: string[]): boolean {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) return false;

  for (const pattern of patterns) {
    if (patternToRegex(pattern).test(normalizedEmail)) {
      return true;
    }
  }

  return false;
}

export async function isEmailWhitelisted(email: string): Promise<boolean> {
  const patterns = await readEmailWhitelistPatterns();
  return isEmailAllowedByPatterns(email, patterns);
}
