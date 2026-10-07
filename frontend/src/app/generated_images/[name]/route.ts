import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const runtime = 'nodejs';

// `next start` only serves public/ files that existed at build time. Images are written to
// public/generated_images at runtime, so this route serves them (public files still win when present).
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const match = /^[\w-]+\.(png|jpe?g|webp|gif)$/i.exec(name || '');
  if (!match) return new NextResponse('Not found', { status: 404 });

  const baseDir = process.cwd().endsWith('frontend') ? process.cwd() : path.join(process.cwd(), 'frontend');
  try {
    const bytes = await fs.readFile(path.join(baseDir, 'public', 'generated_images', name));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': TYPES[match[1].toLowerCase()], 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
