import { NextRequest, NextResponse } from 'next/server';
import { executeTool } from '@/lib/agent-tools';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const userAuthToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    const body = await req.json();
    const { tool_name, arguments: toolArgs = {} } = body;

    if (!tool_name) {
      return NextResponse.json({ error: 'tool_name is required' }, { status: 400 });
    }

    const result = await executeTool(tool_name, toolArgs, userAuthToken);
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('Error in /api/tools/execute:', error);
    return NextResponse.json({ error: error.message || 'Tool execution failed' }, { status: 500 });
  }
}
