import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

import { SANSKRIT_MODELS } from '@/lib/modelDisplayNames';

export async function GET() {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasStabilityKey = Boolean(process.env.STABILITY_API_KEY);

  const models = SANSKRIT_MODELS.map((m) => ({
    id: m.id,
    name: m.rawName,
    displayName: m.displayName,
    asciiFallback: m.asciiFallback,
    sanskritScript: m.sanskritScript,
    meaning: m.meaning,
    subtitle: m.subtitle,
    tooltip: m.tooltip,
    badge: m.badge,
    description: m.description,
    provider: m.provider,
  }));

  return NextResponse.json({
    models,
    keys: {
      anthropic: hasAnthropicKey,
      stability: hasStabilityKey,
    },
  });
}
