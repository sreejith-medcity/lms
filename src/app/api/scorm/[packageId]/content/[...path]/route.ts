import { NextResponse } from 'next/server';
import { getObject, inferMimeType, securityHeadersFor } from '@/lib/storage';
import { packageFor, viewerFor } from '@/lib/scorm/access';
import { safeRelativePath } from '@/lib/scorm/manifest';

export const dynamic = 'force-dynamic';

/**
 * The package's own files, served under one path so relative links inside
 * it resolve. Only to somebody entitled to the lesson, and never a path
 * that climbs out of the package.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string; path: string[] }> }) {
  const { packageId, path } = await params;
  const rel = safeRelativePath(path.map(decodeURIComponent).join('/'));
  if (!rel) return new NextResponse('Not found', { status: 404 });
  const [found, viewer] = await Promise.all([packageFor(packageId), viewerFor(packageId)]);
  if (!found || !viewer) return new NextResponse('Not allowed', { status: 403 });
  const bytes = await getObject(`${found.pkg.storagePrefix}/${rel}`, 256 * 1024 ** 2);
  if (!bytes) return new NextResponse('Not found', { status: 404 });
  const mime = inferMimeType(rel);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
      ...securityHeadersFor(mime),
    },
  });
}
