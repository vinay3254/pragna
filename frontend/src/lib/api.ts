export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  '';

const TOKEN_STORAGE_KEY = 'pragna-auth-token';
let authToken: string | null =
  typeof window !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAuthToken(): string | null {
  return authToken;
}

function _authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export interface Source {
  document_id: number;
  filename: string;
  snippet: string;
  similarity: number;
}

export const ALLOWED_MODELS = [
  { id: "gemma4:cloud", label: "Praxis", tier: "Tier 1: Implementation — routine coding" },
  { id: "gemma4:31b-cloud", label: "Rhapsody", tier: "Tier 2: Testing / QA" },
  { id: "nemotron-3-super:cloud", label: "Elenchos", tier: "Tier 3: Review" },
  { id: "minimax-m3:cloud", label: "Theoria", tier: "Tier 4: Planning / Architecture / Orchestration" },
] as const;

export interface ApiArtifact {
  id: number;
  message_id?: number;
  title: string;
  language: string | null;
  content?: string;
  created_at?: string;
}

export interface ApiMemory {
  id: number;
  content: string;
  created_at: string;
  source_conversation_id: number | null;
}

export interface ApiToolCall {
  id: number;
  tool_name: string;
  arguments: any;
  result?: any;
  status: 'completed' | 'pending' | 'running' | 'approved' | 'denied' | 'error';
  created_at?: string;
}

export interface ApiMessage {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  feedback: 'up' | 'down' | null;
  sources: Source[] | null;
  parent_id: number | null;
  model: string | null;
  artifacts?: ApiArtifact[];
  tool_calls?: ApiToolCall[];
}

export interface ApiConversation {
  id: number;
  title: string;
  created_at: string;
}

export interface ApiConversationDetail extends ApiConversation {
  active_leaf_id: number | null;
  messages: ApiMessage[];
}

export interface ApiDocument {
  id: number;
  filename: string;
  source: string;
  ingested_at: string;
  chunk_count: number;
}

export interface StreamDoneEvent {
  type: 'done';
  conversation_id: number;
  message_id: number;
  sources: Source[];
  model: string;
}

export interface StreamToolCallEvent {
  type: 'tool_call';
  tool_name: string;
  arguments: any;
}

export interface StreamToolResultEvent {
  type: 'tool_result';
  tool_name: string;
  result: any;
}

export interface StreamConfirmRequiredEvent {
  type: 'confirm_required';
  conversation_id: number;
  tool_call_id: number;
  tool_name: string;
  description: string;
  steps: any[];
}

export interface StreamEventHandlers {
  onToken: (content: string) => void;
  onDone: (event: StreamDoneEvent) => void;
  onError: (message: string) => void;
  onToolCall?: (event: StreamToolCallEvent) => void;
  onToolResult?: (event: StreamToolResultEvent) => void;
  onConfirmRequired?: (event: StreamConfirmRequiredEvent) => void;
}

export interface StreamChatArgs extends StreamEventHandlers {
  conversationId: number | null;
  message: string | null;
  model: string;
  parentId?: number | null;
  documentIds?: number[];
  signal: AbortSignal;
}

async function _consumeSSE(response: Response, handlers: StreamEventHandlers): Promise<void> {
  const { onToken, onDone, onError, onToolCall, onToolResult, onConfirmRequired } = handlers;
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      const event = JSON.parse(part.slice(6));
      if (event.type === 'token') onToken(event.content);
      else if (event.type === 'done') onDone(event as StreamDoneEvent);
      else if (event.type === 'error') onError(event.message);
      else if (event.type === 'tool_call') onToolCall?.(event as StreamToolCallEvent);
      else if (event.type === 'tool_result') onToolResult?.(event as StreamToolResultEvent);
      else if (event.type === 'confirm_required') onConfirmRequired?.(event as StreamConfirmRequiredEvent);
    }
  }
}

export async function streamChat({
  conversationId,
  message,
  model,
  parentId,
  documentIds,
  signal,
  ...handlers
}: StreamChatArgs): Promise<void> {
  const body: Record<string, unknown> = {
    conversation_id: conversationId,
    message,
    model,
  };
  if (parentId !== undefined) {
    body.parent_id = parentId ?? null;
  }
  if (documentIds && documentIds.length > 0) {
    body.document_ids = documentIds;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    handlers.onError(`Failed to connect to backend server (${API_BASE})`);
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Server error');
    handlers.onError(`Backend error (${response.status}): ${errorText}`);
    return;
  }

  await _consumeSSE(response, handlers);
}

export async function setActiveLeaf(
  conversationId: number,
  messageId: number
): Promise<{ conversation_id: number; active_leaf_id: number }> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/active-leaf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify({ message_id: messageId }),
  });
  return response.json();
}

export async function fetchConversations(query = ''): Promise<ApiConversation[]> {
  const url = query
    ? `${API_BASE}/api/conversations?q=${encodeURIComponent(query)}`
    : `${API_BASE}/api/conversations`;
  const response = await fetch(url, { headers: _authHeaders() });
  return response.json();
}

export async function fetchConversation(id: number): Promise<ApiConversationDetail> {
  const response = await fetch(`${API_BASE}/api/conversations/${id}`, { headers: _authHeaders() });
  return response.json();
}

export async function renameConversation(id: number, title: string): Promise<ApiConversation> {
  const response = await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify({ title }),
  });
  return response.json();
}

export async function deleteConversation(conversationId: number): Promise<{ id: number; deleted: boolean }> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: _authHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to delete conversation' }));
    throw new Error(error.detail || 'Delete failed');
  }
  return response.json();
}

export async function uploadDocument(file: File): Promise<ApiDocument> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE}/api/documents/upload`, {
    method: 'POST',
    headers: _authHeaders(),
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Upload failed');
  }
  return response.json();
}

export async function fetchDocuments(): Promise<ApiDocument[]> {
  const response = await fetch(`${API_BASE}/api/documents`, { headers: _authHeaders() });
  return response.json();
}

export async function deleteDocument(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/documents/${id}`, {
    method: 'DELETE',
    headers: _authHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to delete document');
  }
}


export async function sendFeedback(
  messageId: number,
  rating: 'up' | 'down'
): Promise<{ id: number; feedback: string }> {
  const response = await fetch(`${API_BASE}/api/messages/${messageId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify({ rating }),
  });
  return response.json();
}

export async function fetchArtifact(id: number): Promise<ApiArtifact> {
  const response = await fetch(`${API_BASE}/api/artifacts/${id}`, { headers: _authHeaders() });
  return response.json();
}

export async function fetchMemories(): Promise<ApiMemory[]> {
  const response = await fetch(`${API_BASE}/api/memories`, { headers: _authHeaders() });
  return response.json();
}

export async function deleteMemory(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/memories/${id}`, { method: 'DELETE', headers: _authHeaders() });
}

export interface ResumeToolArgs extends StreamEventHandlers {
  conversationId: number;
  toolCallId: number;
  approved: boolean;
}

export async function resumeToolCall({
  conversationId,
  toolCallId,
  approved,
  ...handlers
}: ResumeToolArgs): Promise<void> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/resume-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify({ tool_call_id: toolCallId, approved }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    handlers.onError(error.detail || 'Could not resume: this action is no longer awaiting approval.');
    return;
  }
  await _consumeSSE(response, handlers);
}

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  plan?: string | null;
}

export interface AuthResponse {
  access_token: string;
  user: AuthUser;
}

function _authErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI validation errors (422) come back as a list of
    // {msg, loc, ...} objects rather than a plain string.
    const first = detail[0];
    if (first && typeof first.msg === 'string') return first.msg;
  }
  return fallback;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Registration failed'));
  }
  return response.json();
}

export interface OtpRequestResponse {
  success: boolean;
  message: string;
  expires_in?: number;
  resend_after?: number;
}

export async function requestRegistrationOtp(email: string, name?: string): Promise<OtpRequestResponse> {
  const response = await fetch(`${API_BASE}/api/auth/register/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Failed to send verification code'));
  }
  return response.json();
}

export async function verifyRegistrationOtp(
  email: string,
  code: string,
  password: string,
  name?: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/register/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password, name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Verification failed'));
  }
  return response.json();
}

export async function forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Failed to request reset link'));
  }
  return response.json();
}

export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Failed to reset password'));
  }
  return response.json();
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(_authErrorMessage(error.detail, 'Login failed'));
  }
  return response.json();
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/api/auth/me`, { headers: _authHeaders() });
  if (!response.ok) {
    throw Object.assign(new Error('Not authenticated'), { status: response.status });
  }
  return response.json();
}

export interface VoiceProfile {
  id: string;
  name: string;
  gender: string;
  locale: string;
  accent?: string;
  recommended?: boolean;
}

export async function fetchVoiceProfiles(): Promise<VoiceProfile[]> {
  try {
    const res = await fetch(`${API_BASE}/api/voice/voices`, { headers: _authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return data.voices || [];
  } catch {
    return [];
  }
}

export async function synthesizeSpeech(
  text: string,
  voice: string = 'en-US-AriaNeural',
  language?: string
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/voice/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ..._authHeaders(),
    },
    body: JSON.stringify({ text, voice, language }),
  });
  if (!res.ok) throw new Error('Speech synthesis failed');
  return res.blob();
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'voice.webm');
  const res = await fetch(`${API_BASE}/api/voice/stt`, {
    method: 'POST',
    headers: _authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error('Audio transcription failed');
  const data = await res.json();
  return data.text || '';
}

export function getVoiceWebSocketUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = API_BASE || window.location.origin;
  const wsProto = base.startsWith('https') ? 'wss:' : 'ws:';
  const host = base.replace(/^https?:\/\//, '');
  return `${wsProto}//${host}/api/voice/ws`;
}

export interface BillingOrderResponse {
  order_id: number;
  amount: number;
  currency: string;
  provider: string;
}

export interface BillingConfirmResponse {
  success: boolean;
  plan: string;
  current_period_end: string | null;
}

export interface BillingStatusResponse {
  plan: string;
  current_period_end: string | null;
}

export async function createBillingOrder(): Promise<BillingOrderResponse> {
  const res = await fetch(`${API_BASE}/api/billing/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ..._authHeaders(),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to create billing order');
  }
  return res.json();
}

export async function confirmDemoPayment(orderId: number): Promise<BillingConfirmResponse> {
  const res = await fetch(`${API_BASE}/api/billing/confirm-demo-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ..._authHeaders(),
    },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to confirm payment');
  }
  return res.json();
}

export async function getBillingStatus(): Promise<BillingStatusResponse> {
  const res = await fetch(`${API_BASE}/api/billing/status`, {
    headers: _authHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to fetch billing status');
  }
  return res.json();
}


