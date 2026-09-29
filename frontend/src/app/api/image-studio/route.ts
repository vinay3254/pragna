import { NextRequest, NextResponse } from 'next/server';
import { executeTool } from '@/lib/agent-tools';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const userAuthToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    const body = await req.json();
    const { prompt, model, aspect_ratio = '1:1', style } = body;

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const result = await executeTool('image_generate', { prompt, model, aspect_ratio, style }, userAuthToken);
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('Error in /api/image-studio:', error);
    return NextResponse.json({ error: error.message || 'Image generation failed' }, { status: 500 });
  }
}
