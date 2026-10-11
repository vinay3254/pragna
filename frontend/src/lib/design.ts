import { API_BASE, getAuthToken } from '@/lib/api';

export type DesignDevice = 'mobile' | 'web';
export type DesignKind = 'prototype' | 'presentation' | 'document' | 'marketing';
export type DesignRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export interface ArtboardLayout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface DesignTheme {
  primary: string;
  on_primary: string;
  surface: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  radius: string;
  font: string;
}

export interface DesignProject {
  id: number;
  name: string;
  device: DesignDevice;
  theme: DesignTheme;
  created_at: string;
  updated_at: string;
  kind?: DesignKind;
  access_role?: DesignRole;
  design_system_id?: number | null;
  settings?: Record<string, unknown>;
  /** Present on list responses: the first built screen as a static document, for thumbnails. */
  preview_html?: string | null;
  screen_count?: number;
  has_preview?: boolean;
}

export interface DesignScreen {
  id: number;
  name: string;
  position: number;
  version_id: number | null;
  body: string | null;
  /** Full document for the sandboxed iframe, rendered by the server from the project theme. */
  html: string | null;
  quality?: DesignQuality | null;
  layout?: ArtboardLayout;
}

export interface DesignIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface BrowserChecks {
  status: 'checked' | 'unavailable';
  widths: number[];
  buttons_checked: number;
  issues: DesignIssue[];
}

export interface DesignQuality {
  kind: 'source';
  issues: DesignIssue[];
  controls: number;
  local_actions: number;
  has_custom_script: boolean;
  browser?: BrowserChecks;
}

export interface DesignBrief {
  audience?: string;
  goal?: string;
  sections?: string[];
  interactions?: { trigger: string; result: string }[];
  states?: string[];
  responsive?: string;
}

export type GenerationStage = 'planning' | 'building' | 'refining' | 'images';

export interface DesignProjectDetail {
  project: DesignProject;
  screens: DesignScreen[];
  messages?: DesignMessage[];
}

export interface DesignMessage {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  author_name?: string | null;
}

export interface DesignVersion {
  id: number;
  prompt: string | null;
  created_at: string;
}

export type GenerateEvent =
  | {
      type: 'plan';
      project_name: string;
      theme: DesignTheme;
      direction?: string;
      design_brief?: DesignBrief;
      screens: { id: number; name: string; purpose: string; layout?: ArtboardLayout }[];
    }
  | { type: 'status'; stage: GenerationStage; message: string; id?: number }
  | { type: 'screen_draft'; id: number; body: string; html: string }
  | { type: 'notice'; message: string }
  | { type: 'quality'; id: number; version_id: number; browser: BrowserChecks }
  | {
      type: 'screen';
      id: number;
      version_id: number;
      body: string;
      html: string;
      quality?: DesignQuality;
    }
  | { type: 'screen_error'; id: number; error: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

/** Logical frame sizes (px). The design is laid out at these widths. */
export const DEVICE_FRAME: Record<DesignDevice, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  web: { width: 1280, height: 800 },
};

export const THEME_FONTS = [
  'Inter',
  'Poppins',
  'DM Sans',
  'Roboto',
  'Manrope',
  'Space Grotesk',
  'Playfair Display',
  'Lora',
];
export const THEME_RADII = ['0px', '4px', '8px', '12px', '16px', '24px'];
export const THEME_COLORS: { key: keyof DesignTheme; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'on_primary', label: 'On primary' },
  { key: 'surface', label: 'Surface' },
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'border', label: 'Border' },
];

function headers(json = true): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function failure(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  return new Error(typeof detail === 'string' ? detail : `Request failed (${res.status})`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/design${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

export const designApi = {
  listProjects: () => request<DesignProject[]>('/projects?include_previews=false'),
  getPreview: (id: number) => request<{ html: string | null }>(`/projects/${id}/preview`),
  createProject: (
    device: DesignDevice,
    options: { kind?: DesignKind; design_system_id?: number | null } = {}
  ) => request<DesignProjectDetail>('/projects', send('POST', { device, ...options })),
  getProject: (id: number) => request<DesignProjectDetail>(`/projects/${id}`),
  updateProject: (id: number, patch: { name?: string; theme?: DesignTheme }) =>
    request<DesignProjectDetail>(`/projects/${id}`, send('PATCH', patch)),
  deleteProject: (id: number) => request<{ ok: boolean }>(`/projects/${id}`, send('DELETE')),
  editScreen: (id: number, instruction: string, elementHtml?: string) =>
    request<DesignScreen>(
      `/screens/${id}/edit`,
      send('POST', { instruction, element_html: elementHtml })
    ),
  regenerateScreen: (id: number, prompt?: string) =>
    request<DesignScreen>(`/screens/${id}/regenerate`, send('POST', { prompt })),
  deleteScreen: (id: number) => request<{ ok: boolean }>(`/screens/${id}`, send('DELETE')),
  listVersions: (id: number) => request<DesignVersion[]>(`/screens/${id}/versions`),
  restoreVersion: (id: number, versionId: number) =>
    request<DesignScreen>(`/screens/${id}/restore`, send('POST', { version_id: versionId })),
  updateText: (id: number, selector: string, text: string, versionId: number) =>
    request<DesignScreen>(
      `/screens/${id}/text`,
      send('POST', { selector, text, version_id: versionId })
    ),
};

/** Streams generation events (SSE over fetch, so the auth header can be sent). */
export async function streamGenerate(
  projectId: number,
  body: { prompt: string; image?: string; add?: boolean; polish?: boolean; variants?: number },
  onEvent: (event: GenerateEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/design/projects/${projectId}/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new Error('The server sent no data');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  const dispatch = (frame: string) => {
    const payload = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!payload) return;
    let event: GenerateEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === 'done' || event.type === 'error') terminal = true;
    onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      frames.forEach(dispatch);
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        break;
      }
    }
    if (!terminal)
      throw new Error(
        'Generation disconnected before finishing. Completed screens are saved; retry remaining screens.'
      );
  } finally {
    reader.releaseLock();
  }
}

/** Downloads one screen as standalone HTML. */
export async function downloadScreenHtml(screenId: number, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/design/screens/${screenId}/export`, {
    headers: headers(false),
  });
  if (!res.ok) throw await failure(res);
  saveBlob(await res.blob(), `${slug(name)}.html`);
}

export async function downloadProjectZip(projectId: number, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/design/projects/${projectId}/export`, {
    headers: headers(false),
  });
  if (!res.ok) throw await failure(res);
  saveBlob(await res.blob(), `${slug(name)}.zip`);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (name: string): string =>
  name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'screen';

/** Reads an image file as a data URL, enforcing the server's 10MB cap. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Images must be under 10MB'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(file);
  });
}

// Hand-off from the /design home page to a project's canvas. Held in memory (not
// sessionStorage) because an attached image can exceed the storage quota.
let pendingStart: { projectId: number; prompt: string; image?: string } | null = null;

export function setPendingStart(start: {
  projectId: number;
  prompt: string;
  image?: string;
}): void {
  pendingStart = start;
}

export function takePendingStart(projectId: number): { prompt: string; image?: string } | null {
  const start = pendingStart && pendingStart.projectId === projectId ? pendingStart : null;
  pendingStart = null;
  return start;
}
