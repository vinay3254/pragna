import { NextResponse } from 'next/server';
import { readUsageEntries } from '@/lib/usageLog';

export const runtime = 'nodejs';

export async function GET() {
  const entries = readUsageEntries();
  return NextResponse.json({ entries });
}
