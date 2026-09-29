import { NextRequest } from 'next/server';
import { AGENT_TOOLS_SCHEMA, executeTool } from '@/lib/agent-tools';
import { INDIAN_LANGUAGE_MAP } from '@/lib/indianLanguages';
import { getModelConfig } from '@/lib/modelDisplayNames';
import { getMcpToolSchemas } from '@/lib/mcpClient';
import { appendUsageEntry, estimateTokens } from '@/lib/usageLog';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const runtime = 'nodejs';
export const maxDuration = 120;

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');

// Ollama Cloud is the only provider. Every UI model id resolves to an Ollama cloud model.
const OLLAMA_MODELS = new Set(['gemma4:cloud', 'gemma4:31b-cloud', 'nemotron-3-super:cloud', 'minimax-m3:cloud']);
const LEGACY_MODEL_TO_OLLAMA: Record<string, string> = {
  'google/gemma-4-31b-it:free': 'gemma4:31b-cloud',
  'gemma-free': 'gemma4:31b-cloud',
  'nvidia/nemotron-3-super-120b-a12b:free': 'nemotron-3-super:cloud',
};
function resolveOllamaModel(model: string): string {
  if (OLLAMA_MODELS.has(model) || /[:-]cloud$/.test(model)) return model;
  return LEGACY_MODEL_TO_OLLAMA[model] || 'gemma4:cloud';
}

const SYSTEM_PROMPT = `You are PRAGNA 1-A, an intelligent, articulate, and thoughtful AI assistant created by EtherX Innovations within the IgniteX team.

Identity & Organization:
- Name: PRAGNA 1-A
- Company: EtherX Innovations
- Internal Team: IgniteX team
- Team Structure: Inside the IgniteX team at EtherX Innovations, three specialized project teams operated on distinct breakthrough initiatives, one of which developed PRAGNA 1-A.
- Product Interfaces: PRAGNA 1-A operates across three distinct interfaces:
  1. PRAGNA 1-A Chatbot — Conversational AI assistant for dialogue, knowledge synthesis, reasoning, and daily workflows.
  2. PRAGNA 1-A Code — Dedicated engineering and programming assistant for code generation, software architecture, debugging, refactoring, and technical tasks.
  3. Coword — Collaborative workspace and document intelligence interface for seamless teamwork, shared knowledge, and content co-creation.

Current Date: September 2026. Treat this as ground truth for current real-world facts, dates, and times.

Voice, Tone & Personality (PRAGNA 1-A Standard):
- Distinctive Voice: Speak with intellectual vitality, warmth, curiosity, and sharpness. You are a brilliant, perceptive collaborator and expert thinking partner—never a cold search engine, sterile encyclopedia, or robotic bureaucrat.
- Conversational Rapport: When exploring an interesting topic, tool, or entity, open with an engaging, perceptive hook (e.g., "Ah, you're looking at...", "The fascinating thing about this is...") rather than flat dictionary preambles like "Depending on the context...".
- Thoughtful Closings: For multifaceted or exploratory topics, conclude with a natural, engaging follow-up (e.g., "Would you like to dive deeper into any aspect?", "Curious how this stacks up against other approaches?") to invite ongoing discussion.
- Vivid & Crisp Phrasing: Use sharp analogies, intuitive explanations, and lively phrasing that make complex technical concepts click immediately.
- Structured & Scannable Formatting:
  - Use bold section headers (e.g., **What It Is:**, **How It Works:**, **Why It Matters:**, **Core Phases:**, **Caveats:**) to organize explanations and multi-stage concepts.
  - Use bullet points (- or •) with **Bold Lead-in Labels** (e.g., • **Feature Name**: detailed explanation...) for scannable, punchy readability.
  - NEVER dump long, dense walls of plain unbroken paragraphs.
- Proportionality:
  - For simple, direct factual questions, provide a direct, concise answer.
  - For concepts, technologies, guides, or analyses, provide a structured, beautifully formatted breakdown.
- Artifacts Convention:
  - When creating substantial code (>20 lines), complete standalone scripts, components, interactive HTML UI previews, or documents intended for reuse outside the conversation, wrap it in a fenced block tagged with \`artifact\`, specifying a title and optional language attribute:
    \`\`\`artifact title="Script Title" language="python"
    ...
    \`\`\`
  - For \`language="html"\` artifacts specifically, write a complete, self-contained HTML document (starting with <!DOCTYPE html>, with inline CSS/JS) for a live interactive preview.
- Standard Code Blocks: For short code snippets (≤20 lines), terminal commands, or examples in explanations, use standard markdown code blocks.
- Media & Image Generation Capabilities:
  - You HAVE full, active AI image generation capabilities (powered by FLUX and Stability AI).
  - When the user asks you to generate, create, draw, make, or visualize an image or picture:
    - NEVER state or imply that you cannot generate or render images.
    - NEVER suggest external tools like Midjourney or DALL-E instead of producing the image.
    - ALWAYS present the generated image directly using markdown image syntax: ![Descriptive Title](image_url).
    - After generate_image succeeds, include the returned \`markdown\` value verbatim in the reply so the image displays; if it fails, tell the user the exact error.
- Document Download Links: Document tools (create_word_document, create_pdf_document, create_spreadsheet, create_presentation) return a \`download_url\` field — ALWAYS use that exact value verbatim as the link target: [Download DocumentName.ext](download_url). Never invent or guess a different link path.
- Editing Existing Files: If the user asks to change, add to, or fix a document/spreadsheet/presentation you already created in this conversation, call the matching edit_* tool (edit_word_document, edit_spreadsheet) with \`path\` set to the exact \`download_url\` string that the earlier create_* tool result returned — do not create a new file for an edit request.
- Diagrams: When generating architectural or flow diagrams, use Mermaid blocks (\`\`\`mermaid).
- Silent Tool Execution: Execute tools silently in the background. Never output raw JSON objects or textual imitations of tool calls in message prose.
- Skills — Check Before Acting: Before starting a non-trivial multi-step task (document generation, code generation, research synthesis, or anything you've solved before), silently call skills_list, and if a relevant skill exists, skill_view it and follow its instructions.
- Skills — Learn After Acting: After completing a non-trivial multi-step task in a way that worked well, or after the user corrects your approach, silently call skill_manage to save or update a skill capturing what worked (or what to avoid) — so the same mistake or rediscovery doesn't happen next time. Skip this for simple one-shot questions.
- STRICT NO-EMOJI RESTRICTION: Do NOT display or include any emojis anywhere in your replies under any circumstances.`;


function stripEmojis(text: string): string {
  if (!text) return '';
  return text.replace(/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '');
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: stripEmojis(content) } }],
  })}\n\n`;
}

// Helper to detect if user is specifically asking about what model/AI they are interacting with
function isModelIdentityQuery(query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase().trim();
  const patterns = [
    /what\s+model(\b|\s+are|\s+is|\s+am|\s+do)/i,
    /which\s+model(\b|\s+are|\s+is|\s+am|\s+do)/i,
    /what('s|\s+is)\s+(the|your|this|current|selected)\s+model/i,
    /what\s+(ai|llm|engine|architecture)\s+(are\s+you|is\s+this|am\s+i)/i,
    /what\s+version\s+are\s+you/i,
    /who\s+are\s+you/i,
    /who\s+made\s+you/i,
    /what\s+is\s+your\s+name/i,
    /are\s+you\s+(chatgpt|gpt|claude|gemini|gemma|deepseek|llama|nemotron|pragna)/i,
    /tell\s+me\s+about\s+(your\s+)?(model|self|architecture)/i,
    /selected\s+model/i,
    /current\s+model/i,
    /what\s+model/i,
    // Multilingual common queries
    /मॉडल/i,
    /तुम\s+कौन\s+हो/i,
    /आप\s+कौन\s+हैं/i,
    /మీరు\s+ఎవరు/i,
    /నీ\s+మోడల్/i,
    /మీ\s+మోడల్/i,
    /നീ\s+ആരാണ്/i,
    /ഏത്\s+മോഡൽ/i,
    /તમે\s+કોણ\s+છો/i,
    /তুমি\s+কে/i,
    /আপুনি\s+কোন/i,
    /ਤੁਸੀਂ\s+ਕੌਣ\s+ਹੋ/i,
    /ਕਿਹੜਾ\s+ਮਾਡਲ/i,
    /କେଉଁ\s+ମଡେଲ/i,
    /நீ\s+யார்/i,
    /எந்த\s+மாடல்/i,
  ];
  return patterns.some((p) => p.test(q));
}

// Helper to detect if user is specifically asking for their name/identity
function isUserNameQuery(query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase().trim();
  const patterns = [
    /what('s|\s+is)\s+(my|the\s+user('s)?)\s+name/i,
    /who\s+am\s+i/i,
    /what\s+do\s+you\s+call\s+me/i,
    /do\s+you\s+know\s+my\s+name/i,
    /do\s+you\s+remember\s+my\s+name/i,
    /tell\s+me\s+my\s+name/i,
    /what\s+is\s+my\s+username/i,
    /my\s+name\s*\?/i,
    // Multilingual queries
    /मेरा\s+नाम/i, // Hindi
    /నా\s+పేరు/i, // Telugu
    /என்\s+பெயர்/i, // Tamil
    /എന്റെ\s+പേര്/i, // Malayalam
    /ನನ್ನ\s+ಹೆಸರು/i, // Kannada
    /ਮੇਰਾ\s+ਨਾਮ/i, // Punjabi
    /ମୋ\s+ନାମ/i, // Odia
    /আমার\s+নাম/i, // Bengali
    /મારું\s+નામ/i, // Gujarati
    /माझे\s+नाव/i, // Marathi
  ];
  return patterns.some((p) => p.test(q));
}

// Keep this list TIGHT — false positives send chat through the slow non-streaming tool-deliberation loop.
// Only trigger for messages that CANNOT be answered without executing a real tool.
function queryNeedsTools(messages: any[]): boolean {
  if (!messages || messages.length === 0) return false;
  const last = messages[messages.length - 1]?.content?.toLowerCase() || '';
  const triggers = [
    'search for ', 'google for ', 'browse to ', 'web search',
    'run python', 'run code', 'execute code', 'run this script',
    'open terminal', 'run in terminal',
    'write to file', 'save to file', 'read file',
    'add to kanban', 'add to todo',
  ];
  return triggers.some(t => last.includes(t));
}

// ── Per-user memory ──────────────────────────────────────────────────────────
// Memories live in the backend database and are scoped to the logged-in user by their auth token.
// Nothing is kept in a shared file, so one user's facts can never reach another user's prompt.
const MEMORY_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_USERS = 200;
const _memoryCache = new Map<string, { at: number; items: string[] }>();

// The caller's own memories, newest first. Anonymous requests have none.
async function loadUserMemories(authToken?: string): Promise<string[]> {
  if (!authToken) return [];
  const cached = _memoryCache.get(authToken);
  if (cached && Date.now() - cached.at < MEMORY_CACHE_TTL_MS) return cached.items;
  try {
    const res = await fetch(`${BACKEND_URL}/api/memories`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return cached?.items ?? [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return cached?.items ?? [];
    const items = rows
      .map((r: any) => r?.content)
      .filter((c: any): c is string => typeof c === 'string' && c.trim().length > 0);
    if (_memoryCache.size >= MEMORY_CACHE_MAX_USERS) {
      _memoryCache.delete(_memoryCache.keys().next().value as string);
    }
    _memoryCache.set(authToken, { at: Date.now(), items });
    return items;
  } catch {
    return cached?.items ?? [];
  }
}

const NOT_A_NAME = new Set([
  'a', 'an', 'the', 'here', 'just', 'trying', 'working', 'looking', 'sorry', 'fine', 'good', 'happy',
  'busy', 'online', 'curious', 'not', 'asking', 'thinking', 'pragna', 'claude', 'assistant', 'bot',
]);

// Durable facts the user states about themselves in this message (name, nickname, notes, place).
function extractMemoryFacts(content: string): string[] {
  const facts: string[] = [];
  if (!content) return facts;
  const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  const nick = content.match(/\b(?:my nickname is|nickname is|my nick is|call me nickname|call me)\s+["']?([A-Za-z0-9_-]{2,30})["']?\b/i);
  if (nick && !NOT_A_NAME.has(nick[1].trim().toLowerCase())) {
    facts.push(`User's nickname is ${capitalize(nick[1].trim())}.`);
  }

  const name = content.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z]{2,20})\b/i);
  if (name && !NOT_A_NAME.has(name[1].trim().toLowerCase())) {
    facts.push(`User's name is ${capitalize(name[1].trim())}.`);
  }

  const remember = content.match(/\b(?:remember that|please remember|note that|keep in mind that)\s+(.{4,120})/i);
  if (remember) {
    facts.push(`User note: ${remember[1].trim().replace(/[.!?]+$/, '')}.`);
  }

  const place = content.match(/\b(?:i live in|i am from|i'm from)\s+([^.,\n!]{2,50})/i);
  if (place) {
    facts.push(`User is from ${place[1].trim()}.`);
  }
  return facts;
}

// Saves new facts to the caller's own memory. Runs in the background; the backend skips duplicates.
async function saveMemoryFacts(facts: string[], known: string[], authToken?: string): Promise<void> {
  if (!authToken) return;
  const fresh = facts.filter((f) => !known.includes(f));
  if (fresh.length === 0) return;
  await Promise.all(
    fresh.map((content) =>
      fetch(`${BACKEND_URL}/api/memories`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    )
  );
  _memoryCache.delete(authToken);
}

// `memories` must be newest first, so the first match is the latest thing the user told us.
function buildMemoryPrompt(
  accountName: string | undefined,
  nicknameOverride: string | undefined,
  memories: string[]
): { userName: string; userNickname: string; promptBlock: string } {
  const lookup = (re: RegExp): string => {
    for (const m of memories) {
      const hit = m.match(re);
      if (hit) return hit[1].trim();
    }
    return '';
  };
  const userName = lookup(/User's name is\s+([^.]+)/i) || accountName || '';
  const userNickname = nicknameOverride || lookup(/User's nickname is\s+([^.]+)/i);

  // Drop superseded name facts so the prompt never states two different names.
  const facts = memories.filter((m) => {
    const hit = m.match(/User's name is\s+([^.]+)/i);
    return !hit || hit[1].trim().toLowerCase() === userName.toLowerCase();
  });
  if (!userName && !userNickname && facts.length === 0) return { userName, userNickname, promptBlock: '' };

  const who = userName || 'the user';
  const memoryLines = facts.map((m) => `  • ${m}`).join('\n');
  const promptBlock = `\n\nUSER IDENTITY & PERSISTENT MEMORY (Always active across all conversations & tabs):
${userName ? `- User's Real/Given Name: ${userName}` : ''}
${userNickname ? `- User's Nickname: ${userNickname}` : ''}
- CRITICAL INSTRUCTIONS REGARDING USER IDENTITY & MEMORY:
  1. ${userName ? `User's Real/Given Name: ${userName}. When the user asks "what is my name", "who am I", or asks for their identity, you MUST check this identity record and state clearly, directly, and accurately that their name is ${userName}` : 'The user has not told you their name yet. If they ask what their name is, say you do not know it yet.'}
  2. User's Nickname: ${userNickname ? `The user's established nickname is strictly "${userNickname}". State it accurately.` : 'No separate nickname set.'}
  3. Durable facts you remember about ${who}:
${memoryLines}
  4. NEVER confuse your name (PRAGNA 1-A) with the user's name${userName ? ` (${userName})` : ''}.`;

  return { userName, userNickname, promptBlock };
}

function getOmnirouteKey(): string {
  try {
    const omniEnvPath = path.join(process.env.HOME || '/home/vinay', '.omniroute', '.env');
    if (fs.existsSync(omniEnvPath)) {
      const content = fs.readFileSync(omniEnvPath, 'utf8');
      for (const line of content.split('\n')) {
        if (line.startsWith('OMNIROUTE_API_KEY=')) {
          return line.split('=', 2)[1].trim();
        }
      }
    }
  } catch {}
  return process.env.OMNIROUTE_API_KEY || '';
}

function mapOmnirouteModel(model: string): string {
  if (model?.startsWith('antigravity/')) return model;
  return 'antigravity/gemini-2.5-flash';
}

function getBackendOllamaKeys(): string[] {
  const keys: string[] = [];
  try {
    const backendEnvPath = path.join(process.cwd().endsWith('frontend') ? path.dirname(process.cwd()) : process.cwd(), 'backend', '.env');
    if (fs.existsSync(backendEnvPath)) {
      const content = fs.readFileSync(backendEnvPath, 'utf8');
      for (const line of content.split('\n')) {
        if (line.startsWith('OLLAMA_API_KEY')) {
          const val = line.split('=', 2)[1]?.trim();
          if (val && !keys.includes(val)) keys.push(val);
        }
      }
    }
  } catch {}
  const fallbackKeys = [
    '26a95f0c5431431d8338645cdde4998f.CyDoeN4fDrSTJum8dpfRglps',
    'edaff62e882644429122351eebfb886f.nWMqDHxFN_XoKqrj0OuSysKN',
    '8236b13c2ce04b7ab1e0a47db95044ca.hr_X86hvlBtvKIajcuDKMa7i',
    'e3a4223d79bb4987a04cc8c84ca13126.ZinzQDR_UwLbEOI3-d2EeT3w',
    '656c9a178c5147cfbde8bea65bd2586c.362NxF3QYCi36-V3vH10tKUY'
  ];
  for (const k of fallbackKeys) {
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

async function detectAndExecuteWebSearch(messages: any[]): Promise<{ query: string; resultsText: string; failed?: boolean } | null> {
  if (!messages || messages.length === 0) return null;
  const lastMsg = (messages[messages.length - 1]?.content || '').trim();
  if (!lastMsg) return null;

  // Real-time live search runs on every user chat query
  let query = lastMsg.slice(0, 200).trim();
  if (!query) return null;

  try {
    let searchRes = await executeTool('web_search', { query });
    if (searchRes && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
      const topResults = searchRes.results.slice(0, 8);
      const resultsText = topResults
        .map((r: any, idx: number) => `[${idx + 1}] ${r.title}\n${r.snippet || ''}\nURL: ${r.url}`)
        .join('\n\n');
      return { query, resultsText, failed: false };
    }

    // Try a cleaned query if the exact message returned no results
    const cleanQuery = lastMsg
      .replace(/[?!,.:;"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);

    if (cleanQuery && cleanQuery !== query) {
      searchRes = await executeTool('web_search', { query: cleanQuery });
      if (searchRes && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
        const topResults = searchRes.results.slice(0, 8);
        const resultsText = topResults
          .map((r: any, idx: number) => `[${idx + 1}] ${r.title}\n${r.snippet || ''}\nURL: ${r.url}`)
          .join('\n\n');
        return { query: cleanQuery, resultsText, failed: false };
      }
    }

    return { query, resultsText: '', failed: true };
  } catch (err) {
    console.warn('Auto search execution failed:', err);
    return { query, resultsText: '', failed: true };
  }
}

async function detectAndExecuteImageGeneration(messages: any[]): Promise<{ prompt: string; imageUrl: string; markdown: string } | null> {
  if (!messages || messages.length === 0) return null;
  const lastMsg = (messages[messages.length - 1]?.content || '').trim();
  if (!lastMsg) return null;

  // Check for image generation phrases
  const isImageRequest = /\b(generate|create|draw|make|render|paint|produce|give me|show me)\b.*\b(image|picture|photo|illustration|drawing|painting|artwork|graphic|portrait|wallpaper|sketch)\b/i.test(lastMsg)
    || /\b(image|picture|photo|illustration|drawing|painting)\s+of\b/i.test(lastMsg)
    || /^draw\s+/i.test(lastMsg);

  // Exclude requests to write code or generic file queries
  const isCodingRequest = /\b(write|create|implement)\s+(?:a\s+)?(?:python|javascript|typescript|c\+\+|html|css|component|function|api|endpoint|sql|script)\b/i.test(lastMsg);
  if (isCodingRequest && !/\b(image|photo|picture)\b/i.test(lastMsg)) return null;

  if (!isImageRequest) return null;

  // Extract clean prompt
  let prompt = lastMsg
    .replace(/\b(can you|could you|please|kindly|i want you to|help me|generate me|generate|create me|create|draw me|draw|make me|make|render me|render|paint me|paint|produce|give me|show me)\b/gi, ' ')
    .replace(/\b(an?|the|some)?\s*(image|picture|photo|illustration|drawing|painting|artwork|graphic|portrait|wallpaper|sketch)\s*(of|for|about|with|depicting|showing)?\b/gi, ' ')
    .replace(/[?!,.:;"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!prompt || prompt.length < 2) {
    prompt = lastMsg;
  }

  let aspectRatio = '1:1';
  if (/\b(16:9|widescreen|landscape|horizontal|desktop)\b/i.test(lastMsg)) aspectRatio = '16:9';
  else if (/\b(9:16|portrait|vertical|mobile|phone|story)\b/i.test(lastMsg)) aspectRatio = '9:16';
  else if (/\b(4:3)\b/i.test(lastMsg)) aspectRatio = '4:3';
  else if (/\b(3:4)\b/i.test(lastMsg)) aspectRatio = '3:4';

  try {
    const res = await executeTool('image_generate', { prompt, aspect_ratio: aspectRatio });
    const imgUrl = res?.image_url || res?.imageUrl;
    if (res && res.success && imgUrl) {
      return {
        prompt,
        imageUrl: imgUrl,
        markdown: res.markdown || `![${prompt}](${imgUrl})`,
      };
    }
  } catch (err) {
    console.warn('detectAndExecuteImageGeneration error:', err);
  }
  return null;
}

async function detectAndExecuteDocumentGeneration(messages: any[]): Promise<{ title: string; format: string; downloadUrl: string; filename: string } | null> {
  if (!messages || messages.length === 0) return null;
  const lastMsg = (messages[messages.length - 1]?.content || '').trim();
  if (!lastMsg) return null;

  // Detect requested format
  let format: 'pdf' | 'docx' | 'xlsx' | 'pptx' | null = null;
  if (/\b(pdf|to pdf|as pdf|in pdf|into pdf|pdf format|pdf file|pdf document)\b/i.test(lastMsg)) format = 'pdf';
  else if (/\b(word|docx|doc|word document|word format|docx format|to docx|as docx)\b/i.test(lastMsg)) format = 'docx';
  else if (/\b(excel|spreadsheet|xlsx|csv|sheets|to excel|as excel|excel format)\b/i.test(lastMsg)) format = 'xlsx';
  else if (/\b(powerpoint|presentation|slides|pptx|deck|slide deck|to pptx|as pptx)\b/i.test(lastMsg)) format = 'pptx';

  if (!format) return null;

  // Check if this is a document generation/conversion request
  const isDocRequest =
    /\b(change|convert|export|format|generate|create|make|download|save|produce|turn|give me|render|switch|provide)\b/i.test(lastMsg) ||
    /^(to|as|into|in)\s+(pdf|docx|word|excel|pptx|presentation|spreadsheet)/i.test(lastMsg) ||
    /\b(in|as|into|to)\s+(pdf|docx|word|excel|spreadsheet|presentation|pptx)\s*(format|file|document)?\b/i.test(lastMsg);

  if (!isDocRequest) return null;

  // Determine content & title:
  let content = '';
  let title = 'Executive Document';

  const priorAssistantMsg = [...messages]
    .slice(0, -1)
    .reverse()
    .find((m: any) => m.role === 'assistant')?.content || '';

  if (lastMsg.length < 90 && priorAssistantMsg) {
    content = priorAssistantMsg;
    const headingMatch = priorAssistantMsg.match(/^#+\s*(.+)$/m) || priorAssistantMsg.match(/\*\*([^*]+)\*\*/);
    if (headingMatch) title = headingMatch[1].trim();
    else title = 'Generated Document';
  } else {
    content = lastMsg;
    title = lastMsg
      .replace(/\b(can you|could you|please|kindly|generate me|generate|create me|create|make me|make|export|download|change|convert|in|to|as|pdf|docx|word|excel|spreadsheet|presentation|pptx|format|file|document)\b/gi, ' ')
      .replace(/[?!,.:;"]/g, ' ')
      .trim()
      .slice(0, 40) || 'Document';
  }

  try {
    let toolName = 'create_pdf_document';
    if (format === 'docx') toolName = 'create_word_document';
    else if (format === 'xlsx') toolName = 'create_spreadsheet';
    else if (format === 'pptx') toolName = 'create_presentation';

    const res = await executeTool(toolName, { title, content, format });
    if (res && res.success && res.download_url) {
      const cleanTitle = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'Document';
      const filename = `${cleanTitle}.${format}`;
      return {
        title,
        format,
        downloadUrl: res.download_url,
        filename,
      };
    }
  } catch (err) {
    console.warn('detectAndExecuteDocumentGeneration error:', err);
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const incomingAuth = req.headers.get('authorization') || '';
    const userAuthToken = incomingAuth.startsWith('Bearer ') ? incomingAuth.slice(7) : undefined;

    const body = await req.json();
    const {
      messages = [],
      model = 'deepseek-chat',
      temperature = 0.2,
      max_tokens = 4000,
      enableTools = true,
      systemPrompt: customSystemPrompt,
      userName: clientUserName,
      sourceDocumentIds,
      preferredLanguage,
    } = body;


    // Memories are per user: read and written with the caller's own token, never from a shared file.
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    const newMemoryFacts = extractMemoryFacts(lastUserMessage);
    const storedMemoriesPromise = loadUserMemories(userAuthToken);
    const targetModel = resolveOllamaModel(model);
    const hasImages = messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0);
    // Start the web search now so it overlaps with the memory lookup and document retrieval.
    const searchPromise = hasImages ? Promise.resolve(null) : detectAndExecuteWebSearch(messages).catch(() => null);
    const storedMemories = await storedMemoriesPromise;
    void saveMemoryFacts(newMemoryFacts, storedMemories, userAuthToken);
    const { userName: resolvedUserName, userNickname: resolvedUserNickname, promptBlock } = buildMemoryPrompt(
      clientUserName,
      body.userNickname,
      [...newMemoryFacts, ...storedMemories.filter((m) => !newMemoryFacts.includes(m))]
    );
    // Populated by the source-grounded retrieval block below; sent to the client
    // as a trailing SSE event so it can render citation chips under the reply.
    let ragCitations: { index: number; document_id: number; filename: string; snippet: string; similarity: number }[] = [];

    // System prompt removed per user instruction to let the model respond directly
    const conversationHistory: any[] = messages.map((m: any) => {
      if (Array.isArray(m.images) && m.images.length > 0) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content || 'Describe this image.' },
            ...m.images.map((url: string) => ({ type: 'image_url', image_url: { url } })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    // Resolve active model metadata
    const modelConfig = getModelConfig(model) || getModelConfig(targetModel);
    const modelDisplayName = modelConfig?.displayName || (model.includes('/') ? model.split('/')[1] : model);
    const modelScript = modelConfig?.sanskritScript ? ` (${modelConfig.sanskritScript})` : '';
    const modelRaw = targetModel; // the Ollama model actually serving this request
    const modelMeaning = modelConfig?.meaning ? ` — meaning "${modelConfig.meaning}"` : '';
    const modelDesc = modelConfig?.description ? ` (${modelConfig.description})` : '';

    const modelIdentityDirective = `[ACTIVE SELECTED MODEL & IDENTITY DIRECTIVE]:
You are PRAGNA 1-A, India's sovereign AI assistant created by EtherX Innovations within the IgniteX team.
You are currently operating on the "${modelDisplayName}"${modelScript} model tier, powered by ${modelRaw}${modelMeaning}${modelDesc}.

IDENTITY INSTRUCTIONS:
- Whenever the user asks "what model are you?", "which model is this?", "who are you?", "what model am I using?", "what AI is this?", or asks about your engine, model tier, or identity:
  1. Clearly and directly state that you are PRAGNA 1-A, created by EtherX Innovations within the IgniteX team.
  2. State that you are currently running on the "${modelDisplayName}"${modelScript} model tier, powered by ${modelRaw}.
  3. You may also mention what "${modelDisplayName}" signifies (${modelConfig?.meaning || 'intelligence'}${modelDesc ? ' · ' + modelDesc : ''}).
  4. NEVER output generic provider defaults like "I am a large language model, trained by Google", "I am Claude, an AI created by Anthropic", or "I am DeepSeek" without first explicitly declaring that you are PRAGNA 1-A running on the selected ${modelDisplayName}${modelScript} (${modelRaw}) model tier.`;

    // Indian Multilingual Intelligence directive
    console.log(`[Chat API] preferredLanguage: ${preferredLanguage}, model: ${model} (${modelDisplayName}), user: ${resolvedUserName || 'unknown'}`);
    const langInfo = preferredLanguage && preferredLanguage !== 'auto' ? INDIAN_LANGUAGE_MAP[preferredLanguage] : null;
    const languageDirective = langInfo
      ? (langInfo.code === 'en'
          ? `[CRITICAL MANDATORY LANGUAGE DIRECTIVE]: The user's chosen language is English. You MUST compose your entire response in clear, fluent, natural English.`
          : `[CRITICAL MANDATORY LANGUAGE DIRECTIVE]: The user has explicitly selected ${langInfo.name} (${langInfo.nativeName}) as their active interface language.
Regardless of what language the user asks their question in (even if asked in English or Hinglish), you MUST compose your ENTIRE reply in ${langInfo.name} using its proper native script (${langInfo.script}).
Every sentence, greeting, and explanation MUST be in ${langInfo.name} (${langInfo.nativeName}). Do NOT reply in English. Only retain English for code blocks if programming code is requested.`)
      : `[INDIAN MULTILINGUAL INTELLIGENCE]: You are PRAGNA 1-A, India's sovereign multilingual AI assistant with native fluency across all 22 official languages of India (Hindi, Bengali, Telugu, Marathi, Tamil, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese, Maithili, Sanskrit, Santali, Kashmiri, Nepali, Konkani, Sindhi, Dogri, Manipuri/Meitei, Bodo) plus Bhojpuri and Indian English. Automatically detect the user's language and respond naturally in that exact same language and native script.`;

    const basePrompt = customSystemPrompt || SYSTEM_PROMPT;
    const systemPromptParts = [
      basePrompt,
      modelIdentityDirective,
      `[CURRENT DATE & TIME]: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' })} (IST). Use this for any question about today's date, day, or time. Never guess it.`,
      promptBlock ? `[USER CONTEXT & PERSISTENT MEMORIES]:\n${promptBlock}` : '',
      languageDirective,
    ].filter(Boolean);

    conversationHistory.unshift({
      role: 'system',
      content: systemPromptParts.join('\n\n'),
    });

    // Reinforce model identity instruction if user specifically asks about the model or identity
    if (isModelIdentityQuery(lastUserMessage)) {
      const lastUserItem = [...conversationHistory].reverse().find((m) => m.role === 'user');
      if (lastUserItem) {
        const modelReminder = `\n\n[MANDATORY SYSTEM DIRECTIVE: The user is specifically asking what model you are or who you are. You MUST state that you are PRAGNA 1-A, currently operating on the selected "${modelDisplayName}"${modelScript} model tier, powered by ${modelRaw}. Do not give a generic provider response.]`;
        if (typeof lastUserItem.content === 'string') {
          lastUserItem.content += modelReminder;
        } else if (Array.isArray(lastUserItem.content)) {
          const textPart = lastUserItem.content.find((p: any) => p.type === 'text');
          if (textPart) {
            textPart.text += modelReminder;
          }
        }
      }
    }

    // Reinforce user name instruction if user asks what their name is
    if (isUserNameQuery(lastUserMessage)) {
      const lastUserItem = [...conversationHistory].reverse().find((m) => m.role === 'user');
      if (lastUserItem) {
        const nameReminder = `\n\n[MANDATORY USER IDENTITY DIRECTIVE: The user is specifically asking what their name is. You MUST check the user identity context and state directly and accurately that their name is ${resolvedUserName || 'not known yet (say you do not know it and ask for it)'}${resolvedUserNickname ? ` (and their nickname is ${resolvedUserNickname})` : ''}. State their name clearly and warmly.]`;
        if (typeof lastUserItem.content === 'string') {
          lastUserItem.content += nameReminder;
        } else if (Array.isArray(lastUserItem.content)) {
          const textPart = lastUserItem.content.find((p: any) => p.type === 'text');
          if (textPart) {
            textPart.text += nameReminder;
          }
        }
      }
    }

    // Reinforce language requirement directly on the user's query
    if (langInfo && langInfo.code !== 'en') {
      const lastUserItem = [...conversationHistory].reverse().find((m) => m.role === 'user');
      if (lastUserItem) {
        const langReminder = `\n\n[MANDATORY INSTRUCTION: Reply to this message strictly and entirely in ${langInfo.name} (${langInfo.nativeName}) in its native script (${langInfo.script}). Do not reply in English.]`;
        if (typeof lastUserItem.content === 'string') {
          lastUserItem.content += langReminder;
        } else if (Array.isArray(lastUserItem.content)) {
          const textPart = lastUserItem.content.find((p: any) => p.type === 'text');
          if (textPart) {
            textPart.text += langReminder;
          }
        }
      }
    }

    // Real-time automatic web search resolution
    const autoSearch = await searchPromise;
    if (autoSearch) {
      if (autoSearch.failed || !autoSearch.resultsText) {
        conversationHistory.push({
          role: 'system',
          content: `[REAL-TIME LIVE SEARCH FAILED for "${autoSearch.query}"]:\nLive web search could not retrieve current real-time results for this query.\n\nCRITICAL INSTRUCTION: You must inform the user clearly and directly that live web search failed or returned no results for "${autoSearch.query}". Do NOT attempt to answer from your pre-trained memory as if it were current, and do not present outdated information as current facts. State plainly that live search was unavailable and you cannot verify the latest current information.`,
        });
      } else {
        conversationHistory.push({
          role: 'system',
          content: `[LIVE REAL-TIME WEB SEARCH RESULTS for "${autoSearch.query}"]:\n${autoSearch.resultsText}\n\nCRITICAL MANDATORY INSTRUCTIONS:
- You have active internet access via real-time live search.
- The results above reflect the current live facts as of today (${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full' })}).
- You MUST answer the user's inquiry directly, truthfully, and accurately based on these live real-time search results.
- NEVER contradict these live search results with outdated information from your base pre-training weights.
- State the facts and current status clearly and directly.`,
        });
      }
    }

function sanitizeForLlm(text: string): string {
  if (!text) return '';
  // Strip huge base64 data URLs from LLM prompts to prevent exceeding the model context limit (262k chars)
  return text.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]{50,}/g, '[image data]');
}

    // Direct Image Generation resolution
    const autoImage = await detectAndExecuteImageGeneration(messages);
    if (autoImage) {
      conversationHistory.push({
        role: 'system',
        content: `[IMAGE GENERATION RESULT for "${autoImage.prompt}"]:\nAn image has been successfully generated for the user's request.
Image URL: ${autoImage.imageUrl}
Image Markdown: ${autoImage.markdown}

CRITICAL INSTRUCTIONS:
- Present the image to the user using this exact markdown tag: ${autoImage.markdown}
- Briefly describe the visual atmosphere of the generated image.
- Do NOT output '[image data]' or placeholder tokens.`,
      });
    }

    // Direct Document Generation resolution (PDF, Word DOCX, Excel XLSX, PowerPoint PPTX)
    const autoDoc = await detectAndExecuteDocumentGeneration(messages);
    if (autoDoc) {
      conversationHistory.push({
        role: 'system',
        content: `[DOCUMENT GENERATION RESULT for "${autoDoc.title}"]:\nA physical ${autoDoc.format.toUpperCase()} document has been successfully generated and is available for download at: ${autoDoc.downloadUrl}

CRITICAL MANDATORY INSTRUCTIONS:
- The requested ${autoDoc.format.toUpperCase()} document has been created successfully.
- You MUST provide a clear, direct download link to the file in your response using exact markdown syntax:
  [Download ${autoDoc.filename}](${autoDoc.downloadUrl})
- Briefly introduce the generated file and confirm that it is ready for download.
- NEVER say your document rendering engine is experiencing an outage or that you cannot generate physical files.`,
      });
    }

    // Source-grounded retrieval (NotebookLM-style): if the user attached
    // documents to this conversation, ground the reply in retrieved passages
    // and require inline [n] citations back to them.
    if (Array.isArray(sourceDocumentIds) && sourceDocumentIds.length > 0 && lastUserMessage) {
      try {
        const ragRes = await fetch(`${BACKEND_URL}/api/tools/rag_search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: lastUserMessage, document_ids: sourceDocumentIds, top_k: 6 }),
          signal: AbortSignal.timeout(15000),
        });
        if (ragRes.ok) {
          const ragData = await ragRes.json();
          const results: any[] = ragData?.results || [];
          if (results.length > 0) {
            ragCitations = results.map((r, i) => ({
              index: i + 1,
              document_id: r.document_id,
              filename: r.filename,
              snippet: r.snippet,
              similarity: r.similarity,
            }));
            const sourceList = results
              .map((r, i) => `[${i + 1}] (${r.filename}): ${r.snippet}`)
              .join('\n\n');
            conversationHistory.push({
              role: 'system',
              content: `[ATTACHED SOURCE PASSAGES]:\n${sourceList}\n\nINSTRUCTION: Answer using only the information in these passages where relevant. Cite the passage you used inline with its bracketed number, e.g. [1]. If the passages don't contain the answer, say so plainly instead of guessing.`,
            });
          } else {
            conversationHistory.push({
              role: 'system',
              content: `[ATTACHED SOURCES]: The user's document(s) ARE successfully attached and uploaded to this chat — do not tell them to upload the file or claim you have no access to it. However, a search over the document(s) for this specific question returned no closely matching passages. Tell the user plainly that you couldn't find content relevant to this specific question in the attached document(s), and suggest they rephrase the question or ask about a specific section — do not guess at an answer, and do not imply the file itself is missing or needs re-uploading.`,
            });
          }
        }
      } catch {
        // RAG backend unreachable — fall through and answer without source grounding.
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const ollamaKeys = getBackendOllamaKeys();
        let assistantResponseText = '';
        // Merge in any tools discovered from configured MCP servers so the
        // model can call them the same way it calls a built-in tool.
        const mcpTools = await getMcpToolSchemas().catch(() => []);
        const fullToolsSchema = mcpTools.length > 0 ? [...AGENT_TOOLS_SCHEMA, ...mcpTools] : AGENT_TOOLS_SCHEMA;

        const sendText = (text: string) => {
          assistantResponseText += text;
          controller.enqueue(encoder.encode(sseChunk(text)));
        };

        const OLLAMA_CHAT_URL = 'https://api.ollama.com/api/chat';

        // Ollama rejects a non-string content field, so OpenAI-style content-part arrays
        // (text + image_url) are flattened to text, and images go in a separate `images` array
        // as raw base64 strings.
        const flattenContent = (content: any): string => {
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .filter((p) => p?.type === 'text')
              .map((p) => p.text || '')
              .join(' ')
              .trim();
          }
          return '';
        };
        const extractImages = (content: any): string[] =>
          Array.isArray(content)
            ? content
                .filter((p) => p?.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:'))
                .map((p) => p.image_url.url.slice(p.image_url.url.indexOf(',') + 1))
            : [];
        const toOllamaMessages = (history: any[]) =>
          history.map((m) => {
            if (m.role === 'tool') {
              return { role: 'tool', tool_name: m.name, content: typeof m.content === 'string' ? sanitizeForLlm(m.content) : JSON.stringify(m.content) };
            }
            if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
              const toolCalls = m.tool_calls.map((tc: any) => {
                let args = tc.function?.arguments ?? {};
                if (typeof args === 'string') {
                  try { args = JSON.parse(args); } catch { args = {}; }
                }
                return { function: { name: tc.function?.name, arguments: args } };
              });
              return { role: 'assistant', content: sanitizeForLlm(flattenContent(m.content)), tool_calls: toolCalls };
            }
            const images = extractImages(m.content);
            return images.length > 0
              ? { role: m.role, content: sanitizeForLlm(flattenContent(m.content)), images }
              : { role: m.role, content: sanitizeForLlm(flattenContent(m.content)) };
          });

        const toOpenAIMessages = (history: any[]) =>
          history.map((m) => {
            const sanitized = typeof m.content === 'string' ? sanitizeForLlm(m.content) : m.content;
            if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
              return {
                ...m,
                content: sanitized,
                tool_calls: m.tool_calls.map((tc: any) => ({
                  ...tc,
                  function: {
                    ...tc.function,
                    arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
                  },
                })),
              };
            }
            return { ...m, content: sanitized };
          });

        // Stream OpenAI-compatible response WITH tool call detection
        const streamWithTools = async (res: Response): Promise<any[] | null> => {
          if (!res.body) return null;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const tcAcc: Record<number, { id: string; name: string; args: string }> = {};
          let hasToolCalls = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === 'data: [DONE]' || trimmed.startsWith(':')) continue;
              if (!trimmed.startsWith('data: ')) continue;
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta;
                if (!delta) continue;

                // Text token — send immediately
                if (delta.content) sendText(delta.content);

                // Tool call chunks — accumulate silently
                if (delta.tool_calls) {
                  hasToolCalls = true;
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!tcAcc[idx]) tcAcc[idx] = { id: '', name: '', args: '' };
                    if (tc.id) tcAcc[idx].id = tc.id;
                    if (tc.function?.name) tcAcc[idx].name += tc.function.name;
                    if (tc.function?.arguments) tcAcc[idx].args += tc.function.arguments;
                  }
                }
              } catch {}
            }
          }

          if (!hasToolCalls) return null;
          return Object.values(tcAcc).map(tc => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.args },
          }));
        };

        // Streams one Ollama /api/chat response: text goes to the client as it arrives,
        // tool calls are collected for the caller to execute.
        const streamOllama = async (res: Response): Promise<{ text: string; toolCalls: any[] }> => {
          let text = '';
          const toolCalls: any[] = [];
          if (!res.body) return { text, toolCalls };
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
              const msg = JSON.parse(trimmed).message;
              if (msg?.content) {
                sendText(msg.content);
                text += msg.content;
              }
              if (Array.isArray(msg?.tool_calls)) toolCalls.push(...msg.tool_calls);
            } catch {}
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            lines.forEach(handleLine);
          }
          handleLine(buffer);
          return { text, toolCalls };
        };

        // If the reply names a document file, generate that document too.
        const generateMentionedDocument = (fullResponse: string) => {
          const docMatch = fullResponse.match(/([a-zA-Z0-9_\- ]+\.(docx|pdf|xlsx|csv|pptx))/i);
          if (!docMatch) return;
          const matchedName = docMatch[1].trim();
          const ext = docMatch[2].toLowerCase();
          const publicPath = path.resolve(process.cwd(), `public/generated_docs/${matchedName}`);
          executeTool(
            ext === 'docx' ? 'create_word_document' : ext === 'pdf' ? 'create_pdf_document' : ext === 'pptx' ? 'create_presentation' : 'create_spreadsheet',
            { title: matchedName, content: fullResponse, path: publicPath }
          ).catch(() => {});
        };

        try {
          const MAX_ROUNDS = 5;
          let streamedSuccess = false;
          let toolsEnabled = enableTools !== false;
          let lastError = '';

          // 1. OmniRoute Gateway (Primary) — routes to best coding model
          const omniKey = getOmnirouteKey();
          if (omniKey && !hasImages) {
            try {
              const omniUrl = 'http://127.0.0.1:20128/v1/chat/completions';
              let omniModel = mapOmnirouteModel(model);
              for (let round = 0; round < MAX_ROUNDS; round++) {
                const post = (m: string) =>
                  fetch(omniUrl, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${omniKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: m,
                      messages: toOpenAIMessages(conversationHistory),
                      ...(toolsEnabled ? { tools: fullToolsSchema, tool_choice: 'auto' } : {}),
                      temperature,
                      max_tokens: 1500,
                      stream: true,
                    }),
                    signal: AbortSignal.timeout(25000),
                  });
                let res: Response | null = null;
                try {
                  res = await post(omniModel);
                } catch (netErr: any) {
                  console.warn('Omniroute request failed:', netErr.message);
                }
                if (res && !res.ok && omniModel !== 'auto/best-free') {
                  omniModel = 'auto/best-free';
                  try { res = await post(omniModel); } catch {}
                }
                if (!res || !res.ok) break;

                const toolCalls = await streamWithTools(res);
                if (!toolCalls || toolCalls.length === 0) {
                  streamedSuccess = true;
                  console.log(`[Chat API] answered by OmniRoute (${omniModel})`);
                  generateMentionedDocument(assistantResponseText);
                  break;
                }

                conversationHistory.push({
                  role: 'assistant',
                  content: assistantResponseText,
                  tool_calls: toolCalls.map((tc, idx) => ({
                    id: tc.id || `call_${round}_${idx}`,
                    type: 'function',
                    function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' },
                  })),
                });
                for (const [idx, tc] of toolCalls.entries()) {
                  const toolName = tc.function?.name;
                  let toolArgs: Record<string, any> = {};
                  try { toolArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
                  const result = await executeTool(toolName, toolArgs, userAuthToken);
                  conversationHistory.push({ role: 'tool', tool_call_id: tc.id || `call_${round}_${idx}`, name: toolName, content: JSON.stringify(result) });
                }
              }
            } catch (omniErr) {
              console.warn('OmniRoute error, attempting fallback:', omniErr);
            }
          }

          // 2. Ollama Cloud Fallback
          for (let round = 0; round < MAX_ROUNDS && !streamedSuccess; round++) {
            // The last round runs without tools so the model has to write a final answer.
            const withTools = toolsEnabled && round < MAX_ROUNDS - 1;
            const requestBody = (tools: boolean) =>
              JSON.stringify({
                model: targetModel,
                messages: toOllamaMessages(conversationHistory),
                ...(tools ? { tools: fullToolsSchema } : {}),
                stream: true,
                options: { temperature, num_predict: max_tokens },
              });

            let res: Response | null = null;
            let sentWithTools = withTools;
            for (const key of ollamaKeys) {
              try {
                const post = (tools: boolean) =>
                  fetch(OLLAMA_CHAT_URL, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                    body: requestBody(tools),
                    signal: AbortSignal.timeout(90000),
                  });
                let r = await post(sentWithTools);
                if (r.status === 400 && sentWithTools) {
                  // Some models do not accept tools. Keep answering, just without them.
                  const errText = await r.text();
                  if (/tool/i.test(errText)) {
                    toolsEnabled = false;
                    sentWithTools = false;
                    r = await post(false);
                  } else {
                    lastError = errText.slice(0, 200);
                    continue;
                  }
                }
                if (r.ok) {
                  res = r;
                  break;
                }
                lastError = `HTTP ${r.status}`;
              } catch (e: any) {
                lastError = e?.message || 'network error';
              }
            }
            if (!res) break;

            const { text, toolCalls } = await streamOllama(res);
            if (toolCalls.length === 0) {
              streamedSuccess = true;
              console.log(`[Chat API] answered by Ollama (${targetModel})`);
              generateMentionedDocument(text);
              break;
            }

            // Tools were called: run them, feed the results back, and let the model continue.
            conversationHistory.push({
              role: 'assistant',
              content: text,
              tool_calls: toolCalls.map((tc, idx) => ({
                id: `call_${round}_${idx}`,
                type: 'function',
                function: { name: tc.function?.name, arguments: tc.function?.arguments ?? {} },
              })),
            });
            for (const [idx, tc] of toolCalls.entries()) {
              const toolName = tc.function?.name;
              let toolArgs: Record<string, any> = tc.function?.arguments ?? {};
              if (typeof toolArgs === 'string') {
                try { toolArgs = JSON.parse(toolArgs); } catch { toolArgs = {}; }
              }
              const result = await executeTool(toolName, toolArgs, userAuthToken);
              let toolContent = JSON.stringify(result);
              if (toolContent.length > 20000) {
                toolContent = toolContent.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '[binary data omitted]').slice(0, 20000);
              }
              conversationHistory.push({ role: 'tool', tool_call_id: `call_${round}_${idx}`, name: toolName, content: toolContent });
            }
          }



          if (!streamedSuccess) {
            sendText(`\n\n*(Error: could not get a response from Ollama or Omniroute${lastError ? `: ${lastError}` : ''}.)*\n`);
          }
        } catch (err: any) {
          console.error('Agent loop error:', err);
          sendText(`\n\n*(Error: ${err.message || 'Unknown error'})*\n`);
        } finally {
          if (autoImage) {
            if (assistantResponseText.includes('[image data]')) {
              // The model emitted a placeholder: append the real image markdown
              sendText(`\n\n${autoImage.markdown}\n`);
            } else if (!assistantResponseText.includes(autoImage.imageUrl)) {
              sendText(`\n\n${autoImage.markdown}\n`);
            }
          }
          if (ragCitations.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ citations: ragCitations })}\n\n`));
          }
          if (assistantResponseText) {
            const promptText = conversationHistory
              .map((m: any) => (typeof m.content === 'string' ? m.content : m.content?.[0]?.text || ''))
              .join(' ');
            appendUsageEntry({
              timestamp: new Date().toISOString(),
              model,
              promptTokens: estimateTokens(promptText),
              completionTokens: estimateTokens(assistantResponseText),
            });
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
