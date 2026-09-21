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

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://pragna-p7ij.onrender.com';

const FRONTEND_URL =
  process.env.FRONTEND_PUBLIC_URL ||
  'https://frontend-mcce.onrender.com';

// Map UI model IDs to reliable OpenRouter model slugs
const MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4.5',
  'claude-opus-4-5': 'anthropic/claude-opus-4.5',
  'claude-haiku-3-5': 'anthropic/claude-sonnet-4.5',
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-v3': 'deepseek/deepseek-chat',
  'gemma-free': 'google/gemma-4-31b-it:free',
};

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

function getMemoryFilePaths(): string[] {
  const baseDir = process.cwd().endsWith('frontend')
    ? process.cwd()
    : path.join(process.cwd(), 'frontend');
  return [path.join(baseDir, 'data', 'memories.json')];
}

// In-process memory cache to avoid reading memories.json on every single request
let _memoriesCache: { userName: string; userNickname: string; memories: string[] } | null = null;
let _memoriesCacheAge = 0;
const CACHE_TTL_MS = 5000; // refresh from disk every 5 seconds max

function loadMemoriesSync(): { userName: string; userNickname: string; memories: string[] } {
  const now = Date.now();
  if (_memoriesCache && (now - _memoriesCacheAge) < CACHE_TTL_MS) {
    return _memoriesCache;
  }
  const defaultData = {
    userName: 'Kishore',
    userNickname: '',
    memories: ["User's name is Kishore."],
  };
  for (const filePath of getMemoryFilePaths()) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const result = { ...defaultData, ...parsed };
        if (result.userName && result.userName.toLowerCase() === 'vinay') {
          result.userName = 'Kishore';
        }
        if (Array.isArray(parsed.memories) && parsed.memories.length > 0) {
          result.memories = parsed.memories.filter((m: string) => !m.toLowerCase().includes("user's name is vinay"));
        }
        if (!result.memories.some((m: string) => m.toLowerCase().includes("user's name is"))) {
          result.memories.unshift(`User's name is ${result.userName}.`);
        }
        _memoriesCache = result;
        _memoriesCacheAge = now;
        return result;
      }
    } catch {}
  }
  _memoriesCache = defaultData;
  _memoriesCacheAge = now;
  return defaultData;
}

// Async: refresh backend SQLite memories into the file cache (runs in background after response starts)
async function refreshMemoriesFromBackend(): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/memories`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return;
    const backendMemories = await res.json();
    if (!Array.isArray(backendMemories)) return;

    const current = loadMemoriesSync();
    let changed = false;
    for (const item of backendMemories) {
      if (item.content && !current.memories.includes(item.content)) {
        current.memories.push(item.content);
        changed = true;
      }
      // Pull nickname from backend memories too
      if (!current.userNickname && item.content) {
        const m = item.content.match(/User's nickname is\s+([^.]+)/i);
        if (m) { current.userNickname = m[1].trim(); changed = true; }
      }
    }
    if (changed) {
      _memoriesCache = current;
      _memoriesCacheAge = Date.now();
      // Persist back to disk
      for (const filePath of getMemoryFilePaths()) {
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf-8');
        } catch {}
      }
    }
  } catch {}
}

function getPersistentMemories(customUserName?: string, customUserNickname?: string): { userName: string; userNickname: string; promptBlock: string } {
  const data = loadMemoriesSync();
  const userName = (customUserName && customUserName.toLowerCase() !== 'vinay')
    ? customUserName
    : (data.userName && data.userName.toLowerCase() !== 'vinay' ? data.userName : 'Kishore');
  let userNickname = customUserNickname || data.userNickname;

  // Filter out any stale memories with conflicting names
  const validMemories = (data.memories || []).filter((m) => {
    const nameMatch = m.match(/User's name is\s+([^.]+)/i);
    if (nameMatch) {
      return nameMatch[1].trim().toLowerCase() === userName.toLowerCase();
    }
    return true;
  });

  if (!validMemories.some((m) => m.toLowerCase().includes(`user's name is ${userName.toLowerCase()}`))) {
    validMemories.unshift(`User's name is ${userName}.`);
  }

  // Pull nickname from memory facts if not set
  if (!userNickname) {
    for (const m of validMemories) {
      const nickMatch = m.match(/User's nickname is\s+([^.]+)/i);
      if (nickMatch) { userNickname = nickMatch[1].trim(); break; }
    }
  }

  const memoryLines = validMemories.map(m => `  • ${m}`).join('\n');
  const promptBlock = `\n\nUSER IDENTITY & PERSISTENT MEMORY (Always active across all conversations & tabs):
- User's Real/Given Name: ${userName}
${userNickname ? `- User's Nickname: ${userNickname}` : ''}
- CRITICAL INSTRUCTIONS REGARDING USER IDENTITY & MEMORY:
  1. User's Real/Given Name: ${userName}. When the user asks "what is my name", "who am I", or asks for their identity, you MUST check this identity record and state clearly, directly, and accurately that their name is ${userName}.
  2. User's Nickname: ${userNickname ? `The user's established nickname is strictly "${userNickname}". State it accurately.` : 'No separate nickname set.'}
  3. Durable facts you remember about ${userName}:
${memoryLines}
  4. NEVER confuse your name (PRAGNA 1-A) with the user's name (${userName}).`;

  return { userName, userNickname, promptBlock };
}


function updateMemoriesFromMessage(content: string, currentUserName?: string) {
  if (!content) return;
  const targetPaths = getMemoryFilePaths();
  const effectiveName = (currentUserName && currentUserName.toLowerCase() !== 'vinay') ? currentUserName : 'Kishore';
  let data = {
    userName: effectiveName,
    userNickname: '',
    memories: [`User's name is ${effectiveName}.`]
  };

  for (const filePath of targetPaths) {
    try {
      if (fs.existsSync(filePath)) {
        const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        data = { ...data, ...loaded };
        if (data.userName && data.userName.toLowerCase() === 'vinay') {
          data.userName = effectiveName;
        }
        if (Array.isArray(loaded.memories)) {
          data.memories = loaded.memories.filter((m: string) => !m.toLowerCase().includes("user's name is vinay"));
        }
        break;
      }
    } catch (e) {}
  }

  let changed = false;
  const newFactsToSync: string[] = [];

  // Check for nickname extraction
  const nickMatch = content.match(/\b(?:my nickname is|nickname is|my nick is|call me nickname|call me)\s+["']?([A-Za-z0-9_-]{2,30})["']?\b/i);
  if (nickMatch) {
    const candidate = nickMatch[1].trim();
    const invalid = ['a', 'an', 'the', 'here', 'just', 'trying', 'working', 'looking', 'sorry', 'fine', 'good', 'happy', 'busy', 'online', 'curious', 'not', 'asking', 'thinking', 'pragna', 'claude', 'assistant', 'bot', 'vinay'];
    if (!invalid.includes(candidate.toLowerCase())) {
      const formatted = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      data.userNickname = formatted;
      const fact = `User's nickname is ${formatted}.`;
      if (!data.memories.includes(fact)) {
        data.memories.unshift(fact);
        newFactsToSync.push(fact);
      }
      changed = true;
    }
  }

  // Check for name extraction
  const nameMatch = content.match(/\b(?:my name is|i am|i'm)\s+([A-Za-z]{2,20})\b/i);
  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    const invalid = ['a', 'an', 'the', 'here', 'just', 'trying', 'working', 'looking', 'sorry', 'fine', 'good', 'happy', 'busy', 'online', 'curious', 'not', 'asking', 'thinking', 'pragna', 'claude', 'assistant', 'bot'];
    if (!invalid.includes(candidate.toLowerCase())) {
      const formatted = candidate.charAt(0).toUpperCase() + candidate.slice(1);
      data.userName = formatted;
      const fact = `User's name is ${formatted}.`;
      if (!data.memories.includes(fact)) {
        data.memories.unshift(fact);
        newFactsToSync.push(fact);
      }
      changed = true;
    }
  }

  // Check for remember directives
  const remMatch = content.match(/\b(?:remember that|please remember|note that|keep in mind that)\s+(.{4,120})/i);
  if (remMatch) {
    const fact = remMatch[1].trim().replace(/[.!?]+$/, '');
    const entry = `User note: ${fact}.`;
    if (!data.memories.includes(entry)) {
      data.memories.push(entry);
      newFactsToSync.push(entry);
      changed = true;
    }
  }

  // Check for preferences
  const prefMatch = content.match(/\b(?:i live in|i am from|i'm from)\s+([^.,\n!]{2,50})/i);
  if (prefMatch) {
    const place = prefMatch[1].trim();
    const entry = `User is from ${place}.`;
    if (!data.memories.includes(entry)) {
      data.memories.push(entry);
      newFactsToSync.push(entry);
      changed = true;
    }
  }

  if (changed) {
    for (const filePath of targetPaths) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (e) {
        console.error('Error saving memories.json to', filePath, e);
      }
    }
    // Invalidate in-process cache so next request reloads fresh data
    _memoriesCache = null;

    // Sync new facts to backend SQLite asynchronously
    for (const fact of newFactsToSync) {
      fetch(`${BACKEND_URL}/api/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fact }),
      }).catch(() => {});
    }
  }
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

function mapOmnirouteModel(model: string): string {
  switch (model) {
    case 'claude-sonnet-4-5':
      return 'auto/best-coding';
    case 'claude-opus-4-5':
      return 'gpt-6-astra-high';
    case 'claude-haiku-3-5':
      return 'auto/fast';
    case 'deepseek-chat':
    case 'deepseek-v3':
      return 'auto/best-coding';
    case 'google/gemma-4-31b-it:free':
    case 'gemma-free':
      return 'auto/best-free';
    case 'nvidia/nemotron-3-super-120b-a12b:free':
      return 'auto/best-free';
    default:
      return 'auto/best-coding';
  }
}

async function detectAndExecuteWebSearch(messages: any[]): Promise<{ query: string; resultsText: string } | null> {
  if (!messages || messages.length === 0) return null;
  const lastMsg = (messages[messages.length - 1]?.content || '').trim();
  if (!lastMsg) return null;
  const lower = lastMsg.toLowerCase();

  // 1. Skip pure greetings and conversational pleasantries
  const isGreeting = /^(hi|hello|hey|greetings|good morning|good evening|good afternoon|howdy|sup|thanks|thank you|bye|goodbye|ok|okay)[!.? ]*$/i.test(lastMsg);
  if (isGreeting) return null;

  // 2. Skip pure arithmetic
  if (/^what is \d+[\s+\-*/^]+\d+/i.test(lastMsg) || /^calculate /i.test(lastMsg)) return null;

  // 3. Skip pure generic coding requests that have NO real-world entity, model, or product names
  const isPureGenericCoding = /^(write|create|implement|give me|show me)\s+(a\s+)?(python|javascript|typescript|c\+\+|java|rust|go|html|css|sql|function|script|algorithm|regex|class)\s+(to\s+|for\s+)?(reverse|sort|find|sum|calculate|loop|print|check|validate)\b/i.test(lastMsg);
  if (isPureGenericCoding) return null;

  // 4. Check for explicit search intent, URLs, or time-sensitive real-world queries
  const urlMatch = lastMsg.match(/https?:\/\/[^\s]+/i);
  const hasExplicitSearch = /\b(search for|search|google|browse to|look up|check online|find online|web search)\b/i.test(lastMsg);
  const isTimeSensitive = /\b(latest|current|recently|recent|today|tonight|yesterday|this week|this month|this year|2025|2026|newest|breaking news|stock price|weather|election|who won|who is the current|prime minister|president of|release date|openaii?|astra|gpt-?6|deepseek v[34]|claude [45]|gemini [23])\b/i.test(lastMsg);

  if (!urlMatch && !hasExplicitSearch && !isTimeSensitive) {
    return null;
  }

  let query = '';

  if (urlMatch) {
    // If the message is a URL or contains a URL, search for that exact URL or page
    query = urlMatch[0];
  } else {
    // Clean query of conversational prefixes
    query = lastMsg
      .replace(/\b(dont u know|don't you know|did you know|can you|could you|please|use search|search for|search|google it|google|look up|tell me about|tell me|who is|what is|why is)\b/gi, ' ')
      .replace(/[?!,.:;"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Check if query has pronouns or is a short follow-up: enrich with earlier subjects
    const hasPronouns = /\b(he|him|his|she|her|they|them|their|it|its|that|this|the actor|the politician|the model|the company|the quote|the statement)\b/i.test(lastMsg);
    if (hasPronouns || query.split(' ').length <= 4 || messages.length > 2) {
      const priorUserMessages = messages
        .slice(0, -1)
        .filter((m: any) => m.role === 'user')
        .map((m: any) => m.content)
        .join(' ');

      const priorClean = priorUserMessages
        .replace(/\b(hi|hello|who is|what is|tell me|about|and|famous|for|dont u know|did you know|use search)\b/gi, ' ')
        .replace(/[?!,.:;"]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (priorClean) {
        const priorWords = priorClean.split(/\s+/).filter(w => w.length > 3);
        const missingWords = priorWords.filter(w => !lower.includes(w.toLowerCase()));
        if (missingWords.length > 0) {
          query = `${missingWords.slice(0, 3).join(' ')} ${query}`.trim();
        }
      }
    }
  }

  if (!query || query.length < 3) return null;

  try {
    const searchRes = await executeTool('web_search', { query });
    if (searchRes && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
      const topResults = searchRes.results.slice(0, 5);
      const resultsText = topResults
        .map((r: any, idx: number) => `[${idx + 1}] ${r.title}\n${r.snippet || ''}\nURL: ${r.url}`)
        .join('\n\n');
      return { query, resultsText };
    }
  } catch (err) {
    console.warn('Auto search execution failed:', err);
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
      apiKey: customApiKey,
      enableTools = true,
      systemPrompt: customSystemPrompt,
      userName: clientUserName,
      sourceDocumentIds,
      preferredLanguage,
    } = body;

    const omniKey = getOmnirouteKey();
    const openRouterKey =
      customApiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';

    // Inspect user's last message for durable facts to persist
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    updateMemoriesFromMessage(lastUserMessage, clientUserName);

    // Backend SQLite is the shared memory store: pull it first so every model,
    // on every request, sees the same facts.
    await refreshMemoriesFromBackend();
    const { userName: resolvedUserName, userNickname: resolvedUserNickname, promptBlock } = getPersistentMemories(clientUserName, body.userNickname);
    let targetModel = MODEL_MAP[model] || model;
    const hasImages = messages.some((m: any) => Array.isArray(m.images) && m.images.length > 0);
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
    const modelRaw = modelConfig?.rawName || targetModel;
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
    console.log(`[Chat API] preferredLanguage: ${preferredLanguage}, model: ${model} (${modelDisplayName}), user: ${resolvedUserName}`);
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
        const nameReminder = `\n\n[MANDATORY USER IDENTITY DIRECTIVE: The user is specifically asking what their name is. You MUST check the user identity context and state directly and accurately that their name is ${resolvedUserName}${resolvedUserNickname ? ` (and their nickname is ${resolvedUserNickname})` : ''}. State their name clearly and warmly.]`;
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
    const autoSearch = await detectAndExecuteWebSearch(messages);
    if (autoSearch) {
      conversationHistory.push({
        role: 'system',
        content: `[VERIFIED REAL-TIME LIVE SEARCH RESULTS for "${autoSearch.query}"]:\n${autoSearch.resultsText}\n\nINSTRUCTION: Answer the user's inquiry directly, accurately, and honestly using these real-time search results. State the facts clearly without preamble or unnecessary disclaimers.`,
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

        // Stream Ollama response (fallback)
        const pipeOllamaStream = async (res: Response) => {
          if (!res.body) return false;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let streamedAny = false;
          let fullResponse = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const data = JSON.parse(trimmed);
                const token = data.message?.content || '';
                if (token) {
                  sendText(token);
                  fullResponse += token;
                  streamedAny = true;
                }
                if (data.done) {
                  const docMatch = fullResponse.match(/([a-zA-Z0-9_\- ]+\.(docx|pdf|xlsx|csv|pptx))/i);
                  if (docMatch) {
                    const matchedName = docMatch[1].trim();
                    const ext = docMatch[2].toLowerCase();
                    const publicPath = path.resolve(process.cwd(), `public/generated_docs/${matchedName}`);
                    executeTool(
                      ext === 'docx' ? 'create_word_document' : ext === 'pdf' ? 'create_pdf_document' : ext === 'pptx' ? 'create_presentation' : 'create_spreadsheet',
                      { title: matchedName, content: fullResponse, path: publicPath }
                    ).catch(() => {});
                  }
                  return streamedAny;
                }
              } catch {}
            }
          }
          return streamedAny;
        };

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

        try {
          let streamedSuccess = false;
          const MAX_ROUNDS = 4;

          // 1. Try OpenRouter or Local Omniroute (Fast, Tools-enabled)
          // Prioritize OPENROUTER_API_KEY when present since it connects directly to cloud models
          const useOpenRouter = !!openRouterKey;
          let endpointUrl = useOpenRouter
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : (omniKey ? 'http://127.0.0.1:20128/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions');
          let authBearer = useOpenRouter ? openRouterKey : (omniKey || openRouterKey);
          // Omniroute has no direct credentials for provider-qualified slugs like
          // "anthropic/claude-sonnet-4.5" (those are OpenRouter's naming) — it only
          // resolves its own "auto/*" routing aliases. Use the right slug per endpoint.
          let activeModel = useOpenRouter ? targetModel : mapOmnirouteModel(model);

          // Images: the real OpenRouter account behind OPENROUTER_API_KEY is at (near)
          // zero credit balance, so any vision request (image tokens raise the cost
          // well past a trivial text call) gets rejected with 402 before the model
          // ever sees the image. Omniroute's own "antigravity/gemini-2.5-flash" model
          // handles vision for free and works reliably — prefer it for image messages
          // regardless of which endpoint plain text chats use. (Omniroute's "auto/*"
          // aliases can't be used for this: they silently force-route any image-bearing
          // request to a single hardcoded model, ollama-cloud/kimi-k2.6, which is
          // currently unauthorized/out of credits — so target the working model by name.)
          if (hasImages && omniKey) {
            endpointUrl = 'http://127.0.0.1:20128/v1/chat/completions';
            authBearer = omniKey;
            activeModel = 'antigravity/gemini-2.5-flash';
          }

          if (authBearer) {
            for (let round = 0; round < MAX_ROUNDS; round++) {
              let res: Response | null = null;
              try {
                res = await fetch(endpointUrl, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${authBearer}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': FRONTEND_URL,
                    'X-Title': 'ClaudeChat',
                  },
                  body: JSON.stringify({
                    model: activeModel,
                    messages: conversationHistory,
                    tools: fullToolsSchema,
                    tool_choice: 'auto',
                    temperature,
                    max_tokens: 1500,
                    stream: true,
                  }),
                  signal: AbortSignal.timeout(25000),
                });
              } catch (netErr: any) {
                console.warn(`Primary endpoint ${endpointUrl} failed:`, netErr.message);
                // If local Omniroute failed, try OpenRouter directly if we have a key
                if (!useOpenRouter && openRouterKey) {
                  endpointUrl = 'https://openrouter.ai/api/v1/chat/completions';
                  authBearer = openRouterKey;
                  activeModel = targetModel;
                  try {
                    res = await fetch(endpointUrl, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${authBearer}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': FRONTEND_URL,
                        'X-Title': 'ClaudeChat',
                      },
                      body: JSON.stringify({
                        model: activeModel,
                        messages: conversationHistory,
                        tools: fullToolsSchema,
                        tool_choice: 'auto',
                        temperature,
                        max_tokens: 1500,
                        stream: true,
                      }),
                      signal: AbortSignal.timeout(25000),
                    });
                  } catch {}
                }
              }

              // If model returned 400/402/etc. or failed, retry with a fallback model —
              // against real OpenRouter only if we actually have a key for it (otherwise
              // that call is a guaranteed 401 and just wastes the round-trip); against
              // Omniroute, retry with a different "auto/*" alias on its own gateway.
              if (!res || !res.ok) {
                if (openRouterKey && activeModel !== 'deepseek/deepseek-chat') {
                  activeModel = 'deepseek/deepseek-chat';
                  try {
                    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${openRouterKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': FRONTEND_URL,
                        'X-Title': 'ClaudeChat',
                      },
                      body: JSON.stringify({
                        model: activeModel,
                        messages: conversationHistory,
                        tools: fullToolsSchema,
                        tool_choice: 'auto',
                        temperature,
                        max_tokens: 1000,
                        stream: true,
                      }),
                      signal: AbortSignal.timeout(25000),
                    });
                  } catch {}
                } else if (!useOpenRouter && omniKey && activeModel !== 'auto/best-free') {
                  activeModel = 'auto/best-free';
                  try {
                    res = await fetch(endpointUrl, {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${authBearer}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': FRONTEND_URL,
                        'X-Title': 'ClaudeChat',
                      },
                      body: JSON.stringify({
                        model: activeModel,
                        messages: conversationHistory,
                        tools: fullToolsSchema,
                        tool_choice: 'auto',
                        temperature,
                        max_tokens: 1000,
                        stream: true,
                      }),
                      signal: AbortSignal.timeout(25000),
                    });
                  } catch {}
                }
              }

              if (!res || !res.ok) break;


              // Stream response and detect tool calls
              const toolCalls = await streamWithTools(res);

              // No tools called — answer finished
              if (!toolCalls || toolCalls.length === 0) {
                streamedSuccess = true;
                break;
              }

              // Tools were called — execute them silently
              conversationHistory.push({
                role: 'assistant',
                content: null,
                tool_calls: toolCalls.map(tc => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.function.name, arguments: tc.function.arguments },
                })),
              });

              for (const tc of toolCalls) {
                const toolName = tc.function?.name;
                let toolArgs: Record<string, any> = {};
                try { toolArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}
                const result = await executeTool(toolName, toolArgs, userAuthToken);
                conversationHistory.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  name: toolName,
                  content: JSON.stringify(result),
                });
              }
            }
          }

          // 2. Fallback to Cloud Ollama keys if primary did not stream
          if (!streamedSuccess) {
            // Ollama's API rejects a non-string content field outright (400: "cannot
            // unmarshal array into ... content of type string"), so OpenAI-style
            // content-part arrays (text + image_url, used for image attachments)
            // must be flattened to plain text before falling back to it.
            const flattenContentForOllama = (content: any): string => {
              if (typeof content === 'string') return content;
              if (Array.isArray(content)) {
                const text = content
                  .filter((p) => p?.type === 'text')
                  .map((p) => p.text || '')
                  .join(' ')
                  .trim();
                const imageCount = content.filter((p) => p?.type === 'image_url' || p?.type === 'input_image').length;
                return imageCount > 0
                  ? `${text}\n[User attached ${imageCount} image(s) that this fallback model cannot see.]`.trim()
                  : text;
              }
              return '';
            };

            // Flatten conversation history for Ollama compatibility (no tool_call objects)
            const cleanOllamaMessages = conversationHistory.map(m => {
              if (m.role === 'tool') {
                return { role: 'user', content: `[Tool Result: ${m.name || 'tool'}]: ${m.content}` };
              }
              if (m.role === 'assistant' && !m.content) {
                return { role: 'assistant', content: 'Evaluating tool execution...' };
              }
              return { role: m.role, content: flattenContentForOllama(m.content) };
            });

            for (const key of ollamaKeys) {
              try {
                const ollamaRes = await fetch('https://api.ollama.com/api/chat', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: 'gemma4:cloud',
                    messages: cleanOllamaMessages,
                    stream: true,
                  }),
                });
                if (ollamaRes.ok) {
                  const streamed = await pipeOllamaStream(ollamaRes);
                  if (streamed) {
                    streamedSuccess = true;
                    break;
                  }
                }
              } catch {}
            }
          }
        } catch (err: any) {
          console.error('Agent loop error:', err);
          sendText(`\n\n*(Error: ${err.message || 'Unknown error'})*\n`);
        } finally {
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
