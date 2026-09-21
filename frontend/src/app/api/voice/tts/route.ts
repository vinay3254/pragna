import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://pragna-p7ij.onrender.com';

const execFileAsync = promisify(execFile);

// Mapping from language code to recommended Microsoft Edge Neural voice
const VOICE_MAP: Record<string, string> = {
  hi: 'hi-IN-SwaraNeural',
  te: 'te-IN-ShrutiNeural',
  ta: 'ta-IN-PallaviNeural',
  bn: 'bn-IN-TanishaaNeural',
  mr: 'mr-IN-AarohiNeural',
  gu: 'gu-IN-DhwaniNeural',
  kn: 'kn-IN-SapnaNeural',
  ml: 'ml-IN-SobhanaNeural',
  ur: 'ur-IN-GulNeural',
  pa: 'hi-IN-SwaraNeural',
  or: 'hi-IN-SwaraNeural',
  as: 'bn-IN-TanishaaNeural',
  ne: 'ne-NP-HemkalaNeural',
  en: 'en-IN-NeerjaNeural',
  'en-IN': 'en-IN-NeerjaNeural',
  'en-US': 'en-US-AriaNeural',
};

// Clean text for speech
function cleanSpeechText(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1') // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert markdown links to text
    .replace(/[#*_~>|•]/g, '') // Remove markdown formatting symbols
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '') // Strip emojis
    .replace(/(\r\n|\n|\r)+/g, ' ') // Convert linebreaks to spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect language from text script
function detectScriptLanguage(text: string, fallbackLang?: string): { lang: string; voice: string } {
  if (fallbackLang && fallbackLang !== 'auto' && fallbackLang !== 'en' && VOICE_MAP[fallbackLang]) {
    return { lang: fallbackLang, voice: VOICE_MAP[fallbackLang] };
  }

  if (/[\u0C00-\u0C7F]/.test(text)) return { lang: 'te', voice: 'te-IN-ShrutiNeural' };
  if (/[\u0B80-\u0BFF]/.test(text)) return { lang: 'ta', voice: 'ta-IN-PallaviNeural' };
  if (/[\u0980-\u09FF]/.test(text)) return { lang: 'bn', voice: 'bn-IN-TanishaaNeural' };
  if (/[\u0C80-\u0CFF]/.test(text)) return { lang: 'kn', voice: 'kn-IN-SapnaNeural' };
  if (/[\u0D00-\u0D7F]/.test(text)) return { lang: 'ml', voice: 'ml-IN-SobhanaNeural' };
  if (/[\u0A80-\u0AFF]/.test(text)) return { lang: 'gu', voice: 'gu-IN-DhwaniNeural' };
  if (/[\u0A00-\u0A7F]/.test(text)) return { lang: 'pa', voice: 'hi-IN-SwaraNeural' };
  if (/[\u0B00-\u0B7F]/.test(text)) return { lang: 'or', voice: 'hi-IN-SwaraNeural' };
  if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ur', voice: 'ur-IN-GulNeural' };
  if (/[\u0900-\u097F]/.test(text)) {
    if (fallbackLang === 'mr') return { lang: 'mr', voice: 'mr-IN-AarohiNeural' };
    if (fallbackLang === 'ne') return { lang: 'ne', voice: 'ne-NP-HemkalaNeural' };
    return { lang: 'hi', voice: 'hi-IN-SwaraNeural' };
  }

  const defaultLang = fallbackLang && VOICE_MAP[fallbackLang] ? fallbackLang : 'en-IN';
  return { lang: defaultLang, voice: VOICE_MAP[defaultLang] || 'en-IN-NeerjaNeural' };
}

// Transliterate Indic scripts without native Edge voices (Odia, Gurmukhi, Ol Chiki) to phonetic Devanagari
function prepareIndicScriptForSpeech(
  text: string,
  requestedLang?: string
): { spokenText: string; voice: string; googleLang: string; detectedLang: string } {
  // Odia script (\u0B00-\u0B7F) or explicit 'or' language
  if (/[\u0B00-\u0B7F]/.test(text) || requestedLang === 'or') {
    const spokenText = text.replace(/[\u0B00-\u0B7F]/g, (ch) => {
      const code = ch.charCodeAt(0);
      if (code === 0x0b71) return '\u0935'; // Odia WA -> Devanagari VA
      return String.fromCharCode(code - 0x0200);
    });
    return { spokenText, voice: 'hi-IN-SwaraNeural', googleLang: 'hi', detectedLang: 'or' };
  }

  // Gurmukhi script (\u0A00-\u0A7F) or explicit 'pa' language
  if (/[\u0A00-\u0A7F]/.test(text) || requestedLang === 'pa') {
    const spokenText = text.replace(/[\u0A00-\u0A7F]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String.fromCharCode(code - 0x0100);
    });
    return { spokenText, voice: 'hi-IN-SwaraNeural', googleLang: 'pa', detectedLang: 'pa' };
  }

  // Santali Ol Chiki script (\u1C50-\u1C7F) or explicit 'sat' language
  if (/[\u1C50-\u1C7F]/.test(text) || requestedLang === 'sat') {
    const spokenText = text.replace(/[\u1C50-\u1C59]/g, (ch) => {
      return String.fromCharCode(0x0966 + (ch.charCodeAt(0) - 0x1c50));
    });
    return { spokenText, voice: 'hi-IN-SwaraNeural', googleLang: 'hi', detectedLang: 'sat' };
  }

  const detected = detectScriptLanguage(text, requestedLang);
  return {
    spokenText: text,
    voice: detected.voice,
    googleLang: detected.lang.slice(0, 2),
    detectedLang: detected.lang,
  };
}

// Google Translate TTS chunk fetcher
async function fetchGoogleTTS(text: string, lang: string): Promise<Buffer> {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?।|\n]+[.!?।|\n]*/g) || [text];
  let current = '';
  for (const s of sentences) {
    if ((current + ' ' + s).length > 180) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current = (current ? current + ' ' : '') + s;
    }
  }
  if (current) chunks.push(current.trim());

  // Cap at 4 chunks (~700 chars) for fast streaming
  const selectedChunks = chunks.slice(0, 4);

  const buffers = await Promise.all(
    selectedChunks.map(async (c) => {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(c)}&tl=${lang}&client=tw-ob`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) throw new Error(`Google TTS status: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    })
  );

  return Buffer.concat(buffers);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawText = body.text || '';
    const cleanText = cleanSpeechText(rawText);

    if (!cleanText) {
      return NextResponse.json({ error: 'Text cannot be empty' }, { status: 400 });
    }

    const requestedVoice = body.voice;
    const requestedLang = body.language;

    // Transliterate and resolve optimal voice & Google language
    const prepared = prepareIndicScriptForSpeech(cleanText, requestedLang);
    const textSnippet =
      prepared.spokenText.length > 1500 ? prepared.spokenText.slice(0, 1500) + '...' : prepared.spokenText;
    const targetVoice = requestedVoice || prepared.voice;
    const targetLang = prepared.detectedLang;
    const googleLang = prepared.googleLang;

    // ── Tier 1: FastAPI Backend ───────────────────
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      const backendRes = await fetch(`${BACKEND_URL}/api/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textSnippet, voice: targetVoice, language: targetLang }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (backendRes.ok) {
        const audioBuffer = Buffer.from(await backendRes.arrayBuffer());
        if (audioBuffer.length > 500) {
          return new Response(new Uint8Array(audioBuffer), {
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }
    } catch {
      // Backend not running or timed out; proceed to Tier 2
    }

    // ── Tier 2: Direct Edge Neural TTS via Python CLI ───────────────────────
    const tmpFile = path.join(os.tmpdir(), `pragna_tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
    try {
      await execFileAsync(
        'python',
        ['-m', 'edge_tts', '--voice', targetVoice, '--text', textSnippet, '--write-media', tmpFile],
        { timeout: 7000 }
      );

      if (fs.existsSync(tmpFile)) {
        const buffer = fs.readFileSync(tmpFile);
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // ignore cleanup error
        }
        if (buffer.length > 500) {
          return new Response(new Uint8Array(buffer), {
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }
    } catch (edgeErr) {
      if (fs.existsSync(tmpFile)) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // ignore
        }
      }
      console.warn('[TTS API] Edge TTS fallback failed, trying Google TTS:', edgeErr);
    }

    // ── Tier 3: Direct Google Translate Neural Audio Fallback ───────────────
    try {
      const googleBuffer = await fetchGoogleTTS(textSnippet, googleLang);
      if (googleBuffer.length > 500) {
        return new Response(new Uint8Array(googleBuffer), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch (gErr) {
      console.error('[TTS API] Google TTS fallback failed:', gErr);
    }

    return NextResponse.json({ error: 'All TTS engines failed to generate audio' }, { status: 500 });
  } catch (err: any) {
    console.error('[TTS API] Top-level error:', err);
    return NextResponse.json({ error: err.message || 'TTS synthesis failed' }, { status: 500 });
  }
}
