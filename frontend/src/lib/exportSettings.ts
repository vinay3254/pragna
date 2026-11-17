export interface ExportSettings {
  defaultFormat: 'markdown' | 'json' | 'txt';
  filenamePattern: string;
  includeMetadata: boolean;
  includeTimestamps: boolean;
  includeModelInfo: boolean;
}

const STORAGE_KEY = 'pragna-export-settings';

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  defaultFormat: 'markdown',
  filenamePattern: 'pragna-{title}-{date}',
  includeMetadata: true,
  includeTimestamps: true,
  includeModelInfo: true,
};

export function loadExportSettings(): ExportSettings {
  if (typeof window === 'undefined') return DEFAULT_EXPORT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EXPORT_SETTINGS;
    return { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

export function saveExportSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}
