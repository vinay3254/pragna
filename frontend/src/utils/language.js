export const SUPPORTED_LANGUAGE_OPTIONS = [
  { code: "en", label: "English", nativeName: "English (India)", bcp47: "en-IN" },
  { code: "hi", label: "Hindi", nativeName: "हिन्दी", bcp47: "hi-IN" },
  { code: "te", label: "Telugu", nativeName: "తెలుగు", bcp47: "te-IN" },
  { code: "ta", label: "Tamil", nativeName: "தமிழ்", bcp47: "ta-IN" },
  { code: "kn", label: "Kannada", nativeName: "ಕನ್ನಡ", bcp47: "kn-IN" },
  { code: "ml", label: "Malayalam", nativeName: "മലയാളം", bcp47: "ml-IN" },
  { code: "bn", label: "Bengali", nativeName: "বাংলা", bcp47: "bn-IN" },
  { code: "mr", label: "Marathi", nativeName: "मराठी", bcp47: "mr-IN" },
  { code: "gu", label: "Gujarati", nativeName: "ગુજરાતી", bcp47: "gu-IN" },
  { code: "pa", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ", bcp47: "pa-IN" },
  { code: "or", label: "Odia", nativeName: "ଓଡ଼ିଆ", bcp47: "or-IN" },
  { code: "as", label: "Assamese", nativeName: "অসমীয়া", bcp47: "as-IN" },
  { code: "ur", label: "Urdu", nativeName: "اردو", bcp47: "ur-IN" },
  { code: "sa", label: "Sanskrit", nativeName: "संस्कृतम्", bcp47: "sa-IN" },
  { code: "ne", label: "Nepali", nativeName: "नेपाली", bcp47: "ne-NP" },
  { code: "kok", label: "Konkani", nativeName: "कोंकणी", bcp47: "kok-IN" },
  { code: "mai", label: "Maithili", nativeName: "मैथिली", bcp47: "mai-IN" },
  { code: "bho", label: "Bhojpuri", nativeName: "भोजपुरी", bcp47: "bho-IN" },
  { code: "mni", label: "Manipuri", nativeName: "মৈতৈলোন্", bcp47: "mni-IN" },
  { code: "doi", label: "Dogri", nativeName: "डोगरी", bcp47: "doi-IN" },
  { code: "ks", label: "Kashmiri", nativeName: "کٲشُر", bcp47: "ks-IN" },
  { code: "sd", label: "Sindhi", nativeName: "سنڌي", bcp47: "sd-IN" },
  { code: "sat", label: "Santali", nativeName: "संताली", bcp47: "sat-IN" },
  { code: "brx", label: "Bodo", nativeName: "बड़ो", bcp47: "brx-IN" },
];

const VALID_CODES = new Set(SUPPORTED_LANGUAGE_OPTIONS.map((item) => item.code));

const ALIASES = {
  english: "en",
  hindi: "hi",
  tamil: "ta",
  telugu: "te",
  kannada: "kn",
  malayalam: "ml",
  marathi: "mr",
  gujarati: "gu",
  punjabi: "pa",
  bengali: "bn",
  bangla: "bn",
  odia: "or",
  oriya: "or",
  assamese: "as",
  urdu: "ur",
  sanskrit: "sa",
  nepali: "ne",
  konkani: "kok",
  maithili: "mai",
  bhojpuri: "bho",
  manipuri: "mni",
  dogri: "doi",
  kashmiri: "ks",
  sindhi: "sd",
  santali: "sat",
  bodo: "brx",
  "en-us": "en",
  "en-gb": "en",
  "en-in": "en",
  "hi-in": "hi",
  "ta-in": "ta",
  "te-in": "te",
  "kn-in": "kn",
  "ml-in": "ml",
  "mr-in": "mr",
  "gu-in": "gu",
  "pa-in": "pa",
  "bn-in": "bn",
  "or-in": "or",
  "as-in": "as",
  "ur-in": "ur",
  "ur-pk": "ur",
};

export function normalizeLanguageCode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "en";

  if (VALID_CODES.has(raw)) return raw;

  const compact = raw.replace(/_/g, "-");
  if (VALID_CODES.has(compact)) return compact;

  if (ALIASES[compact]) return ALIASES[compact];

  const base = compact.split("-")[0];
  if (VALID_CODES.has(base)) return base;

  if (ALIASES[base]) return ALIASES[base];

  return "en";
}

/**
 * Clean text for Speech Synthesis: strips markdown, think tags, code blocks, emotion tags, and URLs.
 */
export function cleanTextForSpeech(text) {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\[(warm|joyful|empathetic|playful|thoughtful|calm)\]/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_~>]/g, "")
    .replace(/---/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

