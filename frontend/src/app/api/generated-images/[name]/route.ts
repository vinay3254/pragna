import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name || !/^[a-f0-9-]{36}\.webp$/.test(name)) {
      return new NextResponse('Invalid image name', { status: 404 });
    }

    const imagesDir = path.join(os.tmpdir(), 'pragna_images');
    const filePath = path.join(imagesDir, name);

    // Ensure no directory traversal
    if (!filePath.startsWith(imagesDir)) {
      return new NextResponse('Invalid path', { status: 404 });
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      return new NextResponse('Image not found', { status: 404 });
    }
  } catch {
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}