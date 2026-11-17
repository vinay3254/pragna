import { NextResponse } from 'next/server';
import { getMcpServerStatuses } from '@/lib/mcpClient';

export const runtime = 'nodejs';

export async function GET() {
  const servers = await getMcpServerStatuses();
  return NextResponse.json({ servers });
}
