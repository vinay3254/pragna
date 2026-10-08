/**
 * Centralized Single Source of Truth for Model Display Names
 *
 * Maps Sanskrit display names to underlying model IDs and raw names:
 * - "Tvarā" (त्वरा — speed) → DeepSeek V3 (Fast)
 * - "Laghu" (लघु — light/nimble) → Claude Haiku 3.5
 * - "Sthira" (स्थिर — steady/stable) → Claude Sonnet 4.5
 * - "Pragya" (प्रज्ञा — deep wisdom) → Claude Opus 4.5
 * - "Manas" (मनस् — mind/intellect) → Google Gemma 4 31B
 * - "Bṛhat" (बृहत् — vast/immense) → Nvidia Nemotron 120B
 *
 * API calls and model IDs stay 100% UNCHANGED.
 */

export interface SanskritModelConfig {
  /** The underlying API model identifier (e.g. 'deepseek-chat', 'claude-sonnet-4-5') */
  id: string;
  /** Real model display name for subtitles/tooltips */
  rawName: string;
  /** Primary display name with proper diacritics */
  displayName: string;
  /** ASCII fallback if fonts/browsers do not support diacritics */
  asciiFallback: string;
  /** Sanskrit Devanagari script representation */
  sanskritScript: string;
  /** Literal Sanskrit meaning */
  meaning: string;
  /** Formatted subtitle (e.g. "speed · DeepSeek V3 (Fast)") */
  subtitle: string;
  /** Full tooltip for hover state */
  tooltip: string;
  /** Attached badge (Fast, ACTIVE, Pro, Free) */
  badge?: string;
  /** High-level capability description */
  description: string;
  /** Provider key for icons and styling */
  provider: 'deepseek' | 'anthropic' | 'google' | 'nvidia';
}

/**
 * Preserved ordering of all available models
 */
export const SANSKRIT_MODELS: SanskritModelConfig[] = [
  {
    id: 'deepseek-chat',
    rawName: 'DeepSeek V3 (Fast)',
    displayName: 'Tvarā',
    asciiFallback: 'Tvara',
    sanskritScript: 'त्वरा',
    meaning: 'speed',
    subtitle: 'speed · DeepSeek V3 (Fast)',
    tooltip: 'Tvarā (त्वरा) — speed · DeepSeek V3 (Fast)',
    badge: 'Fast',
    description: 'Instant response, high intelligence & live tools',
    provider: 'deepseek',
  },
  {
    id: 'claude-sonnet-4-5',
    rawName: 'Claude Sonnet 4.5',
    displayName: 'Sthira',
    asciiFallback: 'Sthira',
    sanskritScript: 'स्थिर',
    meaning: 'steady/stable',
    subtitle: 'steady/stable · Claude Sonnet 4.5',
    tooltip: 'Sthira (स्थिर) — steady/stable · Claude Sonnet 4.5',
    badge: 'ACTIVE',
    description: 'Deep reasoning & articulate',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-5',
    rawName: 'Claude Opus 4.5',
    displayName: 'Pragya',
    asciiFallback: 'Pragya',
    sanskritScript: 'प्रज्ञा',
    meaning: 'deep wisdom',
    subtitle: 'deep wisdom · Claude Opus 4.5',
    tooltip: 'Pragya (प्रज्ञा) — deep wisdom · Claude Opus 4.5',
    badge: 'Pro',
    description: 'Complex multi-step tasks',
    provider: 'anthropic',
  },
  {
    id: 'claude-haiku-3-5',
    rawName: 'Claude Haiku 3.5',
    displayName: 'Laghu',
    asciiFallback: 'Laghu',
    sanskritScript: 'लघु',
    meaning: 'light/nimble',
    subtitle: 'light/nimble · Claude Haiku 3.5',
    tooltip: 'Laghu (लघु) — light/nimble · Claude Haiku 3.5',
    badge: 'Fast',
    description: 'Fast & efficient',
    provider: 'anthropic',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    rawName: 'Google Gemma 4 31B',
    displayName: 'Manas',
    asciiFallback: 'Manas',
    sanskritScript: 'मनस्',
    meaning: 'mind/intellect',
    subtitle: 'mind/intellect · Google Gemma 4 31B',
    tooltip: 'Manas (मनस्) — mind/intellect · Google Gemma 4 31B',
    badge: 'Free',
    description: 'Open weights (Free)',
    provider: 'google',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    rawName: 'Nvidia Nemotron 120B',
    displayName: 'Bṛhat',
    asciiFallback: 'Brihat',
    sanskritScript: 'बृहत्',
    meaning: 'vast/immense',
    subtitle: 'vast/immense · Nvidia Nemotron 120B',
    tooltip: 'Bṛhat (बृहत्) — vast/immense · Nvidia Nemotron 120B',
    badge: 'Free',
    description: 'High capability (Free)',
    provider: 'nvidia',
  },
];

/** Hide the old six-option menu without suppressing other model lists. */
export function isLegacyModelMenu(identifiers: string[]): boolean {
  return identifiers.length > 0 && identifiers.every((identifier) =>
    SANSKRIT_MODELS.some((model) =>
      [model.id, model.displayName, model.asciiFallback, model.rawName]
        .some((value) => value.toLowerCase() === identifier.trim().toLowerCase())
    )
  );
}

/**
 * Normalizes an arbitrary model string (ID, display name, ASCII fallback, or raw name)
 * to its SanskritModelConfig object.
 */
export function getModelConfig(identifier?: string | null): SanskritModelConfig | undefined {
  if (!identifier) return undefined;
  const clean = identifier.trim().toLowerCase();

  // 1. Exact matches
  const exact = SANSKRIT_MODELS.find(
    (m) =>
      m.id.toLowerCase() === clean ||
      m.displayName.toLowerCase() === clean ||
      m.asciiFallback.toLowerCase() === clean ||
      m.rawName.toLowerCase() === clean
  );
  if (exact) return exact;

  // 2. Keyword heuristic matches
  return SANSKRIT_MODELS.find((m) => {
    const idLow = m.id.toLowerCase();
    const dispLow = m.displayName.toLowerCase();
    const asciiLow = m.asciiFallback.toLowerCase();
    const rawLow = m.rawName.toLowerCase();

    return (
      clean.includes(idLow) ||
      clean.includes(dispLow) ||
      clean.includes(asciiLow) ||
      clean.includes(rawLow) ||
      (m.id === 'deepseek-chat' && (clean.includes('deepseek') || clean.includes('tvara'))) ||
      (m.id === 'claude-sonnet-4-5' && clean.includes('sonnet')) ||
      (m.id === 'claude-opus-4-5' && clean.includes('opus')) ||
      (m.id === 'claude-haiku-3-5' && clean.includes('haiku')) ||
      (m.id === 'google/gemma-4-31b-it:free' && (clean.includes('gemma') || clean.includes('google') || clean.includes('manas'))) ||
      (m.id === 'nvidia/nemotron-3-super-120b-a12b:free' && (clean.includes('nemotron') || clean.includes('nvidia') || clean.includes('brihat') || clean.includes('bṛhat')))
    );
  });
}

/**
 * Returns Sanskrit display name, falling back to ASCII or original input.
 */
export function getSanskritDisplayName(identifier?: string | null): string {
  const config = getModelConfig(identifier);
  return config ? config.displayName : identifier || 'Tvarā';
}

/**
 * Returns ASCII fallback name.
 */
export function getModelAsciiFallback(identifier?: string | null): string {
  const config = getModelConfig(identifier);
  return config ? config.asciiFallback : identifier || 'Tvara';
}

/**
 * Returns subtitle string (meaning + real model name).
 */
export function getModelSubtitle(identifier?: string | null): string {
  const config = getModelConfig(identifier);
  return config ? config.subtitle : '';
}

/**
 * Returns tooltip string.
 */
export function getModelTooltip(identifier?: string | null): string {
  const config = getModelConfig(identifier);
  return config ? config.tooltip : identifier || '';
}

/**
 * Returns underlying API model ID given any display label or identifier.
 */
export function getUnderlyingModelId(identifier?: string | null): string {
  const config = getModelConfig(identifier);
  return config ? config.id : identifier || 'deepseek-chat';
}
