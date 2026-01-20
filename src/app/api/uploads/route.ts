import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });
    }

    const userId = payload.userId as number;
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: 'No files uploaded' }, { status: 400 });
    }

    const uploadedPaths: string[] = [];
    const userUploadDir = path.join(process.cwd(), 'data', 'uploads', String(userId));

    // Ensure user upload directory exists
    await mkdir(userUploadDir, { recursive: true });

    for (const file of files) {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({
          success: false,
          error: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP`
        }, { status: 400 });
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({
          success: false,
          error: `File too large: ${file.name}. Maximum size: 10MB`
        }, { status: 400 });
      }

      // Generate unique filename
      const timestamp = Date.now();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 50);
      const filename = `${timestamp}-${safeName}`;

      // Write file to disk
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filePath = path.join(userUploadDir, filename);
      await writeFile(filePath, buffer);

      // Return the relative path for storage
      uploadedPaths.push(`${userId}/${filename}`);
    }

    return NextResponse.json({
      success: true,
      paths: uploadedPaths,
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    return NextResponse.json({ success: false, error: 'Failed to upload files' }, { status: 500 });
  }
}
