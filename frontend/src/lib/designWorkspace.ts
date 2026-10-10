import { API_BASE, getAuthToken } from '@/lib/api';
import {
  ArtboardLayout,
  DesignKind,
  DesignProjectDetail,
  DesignRole,
  DesignScreen,
  DesignTheme,
} from './design';

export interface BrandSystem {
  id: number;
  name: string;
  theme: DesignTheme;
  guidelines: string;
  components: { name: string; description?: string; html?: string }[];
  is_default: boolean;
}
export interface DesignSource {
  id: number;
  filename: string;
  media_type: string;
  metadata: { width?: number; height?: number; asset_token?: string; truncated?: boolean };
}
export interface DesignComment {
  id: number;
  screen_id: number | null;
  selector: string | null;
  content: string;
  author: string;
  resolved: boolean | number;
  created_at: string;
}
export interface Workspace {
  access_role: DesignRole;
  sources: DesignSource[];
  comments: DesignComment[];
  members: { id: number; user_id: number; email: string; name: string | null; role: DesignRole }[];
  share_token: string | null;
}
export interface CanvasLayer {
  selector: string;
  tag: string;
  depth: number;
  label: string;
  can_edit: boolean;
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/api/design${path}`, {
    method,
    headers: {
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: form ? (body as FormData) : JSON.stringify(body) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`
    );
  }
  return res.json();
}

export const workspaceApi = {
  get: (id: number) => call<Workspace>(`/projects/${id}/workspace`),
  systems: () => call<BrandSystem[]>('/systems'),
  saveSystem: (system: Omit<BrandSystem, 'id'>, id?: number) =>
    call<BrandSystem>(id ? `/systems/${id}` : '/systems', id ? 'PUT' : 'POST', system),
  deleteSystem: (id: number) => call(`/systems/${id}`, 'DELETE'),
  options: (
    id: number,
    patch: {
      kind?: DesignKind;
      design_system_id?: number | null;
      settings?: Record<string, unknown>;
    }
  ) => call<DesignProjectDetail>(`/projects/${id}/options`, 'PATCH', patch),
  upload: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call<DesignSource>(`/projects/${id}/sources`, 'POST', form);
  },
  removeSource: (id: number, source: number) => call(`/projects/${id}/sources/${source}`, 'DELETE'),
  reference: (id: number, content: string, name: string) =>
    call(`/projects/${id}/reference`, 'POST', { content, name }),
  importHtml: (id: number, html: string, name: string) =>
    call<DesignScreen>(`/projects/${id}/import-html`, 'POST', { html, name }),
  capture: (id: number, url: string, selector?: string) =>
    call(`/projects/${id}/capture`, 'POST', { url, selector }),
  systemFromSources: (id: number, name: string, content: string) =>
    call<BrandSystem>(`/projects/${id}/system-from-sources`, 'POST', { name, content }),
  comment: (id: number, content: string, screen_id?: number, selector?: string) =>
    call(`/projects/${id}/comments`, 'POST', { content, screen_id, selector }),
  resolve: (id: number, comment: number, resolved: boolean) =>
    call(`/projects/${id}/comments/${comment}`, 'PATCH', { resolved }),
  member: (id: number, email: string, role: DesignRole) =>
    call(`/projects/${id}/members`, 'POST', { email, role }),
  removeMember: (id: number, member: number) => call(`/projects/${id}/members/${member}`, 'DELETE'),
  share: (id: number) => call<{ token: string }>(`/projects/${id}/share`, 'POST'),
  revokeShare: (id: number) => call(`/projects/${id}/share`, 'DELETE'),
  layers: (id: number) => call<CanvasLayer[]>(`/screens/${id}/layers`),
  canvas: (
    id: number,
    selector: string,
    operation: string,
    version_id: number,
    styles: Record<string, string> = {},
    selectors?: string[]
  ) =>
    call<DesignScreen>(`/screens/${id}/canvas`, 'POST', {
      selector,
      operation,
      version_id,
      styles,
      selectors,
    }),
  duplicateScreen: (id: number) => call<DesignScreen>(`/screens/${id}/duplicate`, 'POST'),
  duplicateProject: (id: number) => call<DesignProjectDetail>(`/projects/${id}/duplicate`, 'POST'),
  artboard: (id: number, patch: ArtboardLayout & { name?: string; position?: number }) =>
    call<DesignScreen>(`/screens/${id}/artboard`, 'PATCH', patch),
  assistant: (id: number, prompt: string) =>
    call<{ content: string }>(`/screens/${id}/assistant`, 'POST', { prompt }),
};

export async function downloadDesign(
  id: number,
  format: 'pdf' | 'pptx' | 'handoff'
): Promise<void> {
  const token = getAuthToken();
  const response = await fetch(`${API_BASE}/api/design/projects/${id}/download/${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail || 'Export failed');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `pragna-design.${format === 'handoff' ? 'zip' : format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
