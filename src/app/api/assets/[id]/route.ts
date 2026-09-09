import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { meter } from '@/lib/usage';
import { signedReadUrl, storageConfigured } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * The only way bytes leave the bucket.
 *
 * Objects are private. A player asks for /api/assets/<id>, we decide whether
 * this person is entitled to it, and only then mint a five-minute signed URL and
 * redirect. Nothing is ever served from a guessable public path, which is the
 * difference between a course library and a public file dump.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });
  if (!storageConfigured()) return new NextResponse('Storage is not configured', { status: 503 });

  const asset = await db.asset.findFirst({
    where: {
      id,
      organizationId: tenant.organizationId,
      deletedAt: null,
      transcodeStatus: { not: 'UPLOADING' },
    },
    select: {
      id: true,
      type: true,
      storageKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      materials: { select: { id: true, isFreePreview: true, isDownloadable: true } },
    },
  });
  if (!asset) return new NextResponse('Not found', { status: 404 });

  const user = await getSessionUser();
  const sameOrg = user?.organizationId === tenant.organizationId;

  // Staff see everything in their own organisation.
  let allowed = Boolean(user && sameOrg && user.kind === 'STAFF');

  // Anyone, signed in or not, may see a material marked as a free preview.
  const freePreview = asset.materials.some((m) => m.isFreePreview);
  if (!allowed && freePreview) allowed = true;

  // Otherwise the learner must be enrolled in a course that uses this file, or
  // in a batch whose recording it is.
  if (!allowed && user && sameOrg) {
    const materialIds = asset.materials.map((m) => m.id);

    const [viaCourse, viaRecording] = await Promise.all([
      materialIds.length
        ? db.enrollment.count({
            where: {
              userId: user.id,
              organizationId: tenant.organizationId,
              status: { notIn: ['CANCELLED', 'ARCHIVED'] },
              product: {
                course: {
                  modules: {
                    some: {
                      module: {
                        sections: { some: { materials: { some: { id: { in: materialIds } } } } },
                      },
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve(0),
      db.recording.count({
        where: {
          assetId: asset.id,
          session: { batch: { enrollments: { some: { userId: user.id } } } },
        },
      }),
    ]);

    allowed = viaCourse > 0 || viaRecording > 0;
  }

  if (!allowed) {
    return new NextResponse(user ? 'Not available on your enrolment' : 'Sign in to view this', {
      status: user ? 403 : 401,
    });
  }

  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const downloadAllowed = asset.materials.some((m) => m.isDownloadable);

  // A ninety-minute class outlives a five-minute link, and the player would stall
  // on the first seek past the expiry. Media gets two hours; everything else stays
  // short, because a leaked document link is worth more to a leaker than a stream.
  const streaming = asset.type === 'VIDEO' || asset.type === 'AUDIO';

  const url = signedReadUrl(asset.storageKey, {
    expiresIn: streaming ? 7200 : 300,
    mimeType: asset.mimeType,
    downloadName: wantsDownload && (downloadAllowed || user?.kind === 'STAFF') ? asset.fileName : null,
  });

  // Egress is estimated per full fetch until CDN logs feed this properly. Range
  // requests are the player seeking inside a file it already started, so counting
  // them would multiply one view of a class recording into twenty.
  if (!request.headers.get('range')) {
    meter(tenant.tenantId, 'BANDWIDTH_BYTES', Number(asset.sizeBytes)).catch(() => {});
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
