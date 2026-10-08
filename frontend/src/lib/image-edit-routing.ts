type ImageMessage = { role?: string; content?: unknown; images?: string[] };

const editVerb = /\b(make|turn|change|edit|modify|convert|transform|add|remove|replace|re-?colou?r|colou?rize|paint|redo|redraw|restyle|put|use|enhance|upscale)\b/i;
const color = '(?:black|white|pink|red|blue|green|yellow|purple|violet|orange|brown|gray|grey|gold|silver|magenta|cyan|teal|turquoise|beige|indigo|maroon|navy|crimson|coral)';
const colorReply = new RegExp(`^(?:(?:dark|light|bright|pale|deep|hot|pastel|neon|soft)\\s+)?${color}(?:\\s+(?:please|instead|now))?[.!]*$`, 'i');
const styleReply = /^(?:anime|cartoon|watercolou?r|oil painting|pencil sketch|pixel art|photorealistic|realistic|ghibli)(?:\s+(?:style|please|instead))?[.!]*$/i;
const newPicture = /\b(new|another|fresh)\b.*\b(image|picture|photo)\b|\b(image|picture|photo|drawing|illustration)\s+(of|for)\b/i;

/** Resolve edits before the language model can turn an actionable request into clarification loops. */
export function resolveImageEdit(
  messages: ImageMessage[],
  existingImage: (candidates: string[]) => string | null,
): { source: string; prompt: string } | null {
  const last = messages.at(-1);
  const text = String(last?.content || '').trim();
  if (!text || last?.role !== 'user') return null;
  if (/^(what|who|where|when|why|how|describe|explain|read|analy[sz]e|tell me|is|are|does|do|can you (see|tell|read|describe))\b/i.test(text)) return null;
  if (newPicture.test(text) && !/\b(edit|change|modify|re-?colou?r|convert|transform|turn)\b/i.test(text)) return null;
  const attached = last?.images?.at(-1);
  if (attached) {
    if (!editVerb.test(text) && !colorReply.test(text) && !styleReply.test(text)
      && !/\b(cartoon|anime|ghibli|painting|sketch|watercolou?r|pixel|oil paint|3d|style|background|filter)\b/i.test(text)) return null;
    return { source: attached, prompt: `${text}\nPreserve all other details of the supplied image unless the requested change requires otherwise.` };
  }
  // Code and UI changes should not recolor a previously generated picture.
  if (/\b(code|css|html|component|button|website|page|theme|hex|function|variable)\b/i.test(text)) return null;

  let source: string | null = null;
  let shownAt = -1;
  for (let i = messages.length - 2; i >= 0; i--) {
    source = existingImage(String(messages[i]?.content || '').match(/\/generated_images\/[\w.-]+/g) || []);
    source ||= messages[i]?.images?.at(-1) || null;
    if (source) { shownAt = i; break; }
  }
  if (!source) return null;
  const imagePrompt = String(messages.slice(0, shownAt + 1).findLast(m => m.role === 'user')?.content || '');
  const subjectWords = (imagePrompt.toLowerCase().match(/[a-z]{3,}/g) || []).filter(w =>
    !/^(make|generate|create|draw|render|paint|produce|give|show|image|picture|photo|illustration|the|and|with|for|please|can|you|could)$/.test(w));
  const namesSubject = subjectWords.some(w => new RegExp(`\\b${w}s?\\b`, 'i').test(text));
  const explicitReference = namesSubject || /\b(image|picture|photo)\b/i.test(text);
  const pronoun = /\b(it|this|that|him|her|them)\b/i.test(text);
  const isFollowup = (value: string) => colorReply.test(value) || styleReply.test(value)
    || (editVerb.test(value) && (/\b(it|this|that|image|picture|photo)\b/i.test(value)
      || subjectWords.some(w => new RegExp(`\\b${w}s?\\b`, 'i').test(value))));
  // Keep context through arbitrary clarification exchanges, but not an unrelated new topic.
  const focused = messages.slice(shownAt + 1, -1).filter(m => m.role === 'user')
    .every(m => isFollowup(String(m.content || '').trim()));
  if (!(editVerb.test(text) && (explicitReference || (pronoun && focused)))
    && !(focused && (colorReply.test(text) || styleReply.test(text)))) return null;
  return { source, prompt: `${text}\nEdit the supplied image. Preserve its subject, setting, composition, and lighting except for the requested changes.` };
}
