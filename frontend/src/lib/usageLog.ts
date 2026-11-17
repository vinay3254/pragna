import * as fs from 'node:fs';
import * as path from 'node:path';

export interface UsageEntry {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const MAX_ENTRIES = 5000;

function getUsageFilePath(): string {
  const baseDir = process.cwd().endsWith('frontend')
    ? process.cwd()
    : path.join(process.cwd(), 'frontend');
  return path.join(baseDir, 'data', 'usage.json');
}

// Token counts are a rough estimate (chars / 4) rather than a real tokenizer
// count -- good enough for a directional cost dashboard, not for billing.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function appendUsageEntry(entry: UsageEntry): void {
  try {
    const filePath = getUsageFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const entries = readUsageEntries();
    entries.push(entry);
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
    fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch {
    // Usage logging is best-effort -- never let it break the chat response.
  }
}

export function readUsageEntries(): UsageEntry[] {
  try {
    const filePath = getUsageFilePath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
