import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: '/api/chat',
};

const WINDOW_MS = 60_000;
const LIMIT = 20;

// In-memory sliding window, per server process. Resets on restart and isn't
// shared across serverless instances -- fine for a single-instance
// deployment, but won't enforce a global limit if scaled out.
const hits = new Map<string, number[]>();

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export function middleware(req: NextRequest) {
  const key = clientKey(req);
  const now = Date.now();
  const timestamps = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= LIMIT) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - timestamps[0])) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please slow down.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return NextResponse.next();
}
