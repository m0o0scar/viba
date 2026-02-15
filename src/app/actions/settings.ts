'use server';

import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Directory likely exists
  }
}

async function readSettingsFile(): Promise<Record<string, unknown>> {
  try {
    await ensureDataDir();
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    // If file doesn't exist or is invalid JSON, return empty object
    return {};
  }
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const settings = await readSettingsFile();
  return (settings[key] as T) || null;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await ensureDataDir();
  // Read current settings to merge
  const settings = await readSettingsFile();
  settings[key] = value;
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
