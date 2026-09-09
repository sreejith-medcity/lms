import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import {
  appendLocalChunk,
  finishLocalUpload,
  localPartSize,
  storageDriver,
  verifyUploadToken,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The local driver's upload endpoint.
 *
 * The browser sends the file in chunks rather than one enormous PUT, for two
 * reasons: shared hosting sits behind a proxy with a request body limit that a
 * 2 GB recording would walk straight into, and a dropped connection then costs
 * one chunk instead of the whole upload. Each chunk is appended to <key>.part
 * and the file only takes its real name once the last one lands, so a half-sent
 * recording can never be mistaken for a complete one.
 *
 * With the S3 driver this route is never called: the browser talks to the bucket.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;

  if (storageDriver() !== 'local') {
    return NextResponse.json({ error: 'This deployment uploads directly to the bucket.' }, { status: 400 });
  }

  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await requireStaff('asset_library.upload_assets', 'edit');
  } catch {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId: tenant.organizationId, transcodeStatus: 'UPLOADING' },
    select: { storageKey: true },
  });
  if (!asset) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });

  const token = request.headers.get('x-upload-token') ?? '';
  if (!verifyUploadToken(token, asset.storageKey)) {
    return NextResponse.json({ error: 'This upload ticket has expired.' }, { status: 403 });
  }

  if (!request.body) {
    return NextResponse.json({ error: 'Empty chunk' }, { status: 400 });
  }

  // A retry after a chunk that landed but whose response was lost would otherwise
  // append the same bytes twice. The client states where it thinks it is; if that
  // disagrees with the file on disk, we say what we actually have and let it
  // resume from there rather than corrupting the upload.
  const offset = Number(request.headers.get('x-chunk-offset') ?? '0');
  const onDisk = await localPartSize(asset.storageKey);
  if (Number.isNaN(offset) || offset !== onDisk) {
    return NextResponse.json({ error: 'Out of order chunk', received: onDisk }, { status: 409 });
  }

  try {
    const received = await appendLocalChunk(asset.storageKey, request.body);

    if (request.headers.get('x-upload-final') === '1') {
      const size = await finishLocalUpload(asset.storageKey);
      return NextResponse.json({ ok: true, done: true, size });
    }

    return NextResponse.json({ ok: true, done: false, received });
  } catch (err) {
    console.error('[uploads]', err);
    return NextResponse.json({ error: 'The chunk could not be written.' }, { status: 500 });
  }
}
