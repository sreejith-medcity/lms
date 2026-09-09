import { NextResponse } from 'next/server';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  inferMimeType,
  localPathFor,
  localReadStream,
  storageDriver,
  verifyMediaPath,
} from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Locally stored bytes, on a path a CDN can hold.
 *
 * The signature is over the object key and does not expire, which is the whole
 * point: an edge cache cannot help if the URL changes every five minutes, and
 * the second learner to open a class recording should never reach this server.
 * Access was already decided at /api/assets before this URL was handed out, and
 * the key is a UUID nobody can guess. Rotating AUTH_SECRET kills every issued
 * link at once.
 *
 * Range requests are answered properly, so seeking inside a ninety-minute class
 * works instead of re-downloading from the start.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (storageDriver() !== 'local') {
    return new NextResponse('Not found', { status: 404 });
  }

  const segments = (await params).path.map((s) => decodeURIComponent(s));
  const signature = segments.shift();
  const key = segments.join('/');
  if (!signature || !key || !verifyMediaPath(signature, key)) {
    return new NextResponse('Not found', { status: 404 });
  }

  let size: number;
  try {
    const info = await stat(localPathFor(key));
    if (!info.isFile()) throw new Error('not a file');
    size = info.size;
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const fileName = key.split('/').pop() ?? 'file';
  const mimeType = inferMimeType(fileName);
  const download = new URL(request.url).searchParams.get('download') === '1';

  const headers = new Headers({
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    // Immutable because the key contains a UUID: this URL can only ever mean
    // this file. A year at the edge is what makes the CDN worth having.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (download) {
    headers.set(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/"/g, '')}"`,
    );
  }

  const range = request.headers.get('range');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);

  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new NextResponse('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));

    return new NextResponse(toWeb(localReadStream(key, start, end)), { status: 206, headers });
  }

  headers.set('Content-Length', String(size));
  return new NextResponse(toWeb(localReadStream(key)), { status: 200, headers });
}

function toWeb(stream: ReturnType<typeof localReadStream>): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}
