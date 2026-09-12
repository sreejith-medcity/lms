import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { meter } from '@/lib/usage';
import { readUrlFor, storageConfigured } from '@/lib/storage';
import { curriculumGate } from '@/lib/curriculum-access';
import { settingText } from '@/lib/settings/store';
import { redirectResponse } from '@/lib/http-headers';
import { assignmentsWhereFor, learnerEnrolments } from '@/lib/assignment-access';

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

  // Branding is public by definition: a logo that only signed-in people can see
  // is a logo nobody sees, since the header renders before anybody signs in.
  const branding = await db.organization.findFirst({
    where: {
      id: tenant.organizationId,
      OR: [
        { logoUrl: { contains: asset.id } },
        { faviconUrl: { contains: asset.id } },
      ],
    },
    select: { id: true },
  });

  // The home page photograph, same argument again: it is the first thing on
  // the public site, so it cannot sit behind a session. Read through the
  // settings store and compared here rather than filtered in the query,
  // because the value column is JSON and a string match on it is a subtlety
  // nobody should have to remember when they change how settings are stored.
  const heroAssetId = await settingText(tenant.organizationId, 'website.heroImageAssetId');
  const heroImage = heroAssetId.trim() !== '' && heroAssetId.trim() === asset.id;

  // A subject card's picture, on the same argument once more: it is on the
  // home page, which is the page nobody has signed in to yet.
  const categoryArt = await db.category.findFirst({
    where: { organizationId: tenant.organizationId, imageAssetId: asset.id, isActive: true },
    select: { id: true },
  });

  // Course artwork is public for the same reason. It is the picture on the
  // catalogue card and at the top of the sales page, both of which are pages
  // we want a search engine and a stranger to see. Only the thumbnail of a
  // published, undeleted course qualifies: this does not open the library.
  const artwork = await db.course.findFirst({
    where: {
      organizationId: tenant.organizationId,
      thumbnailAssetId: asset.id,
      product: { status: 'PUBLISHED', deletedAt: null },
    },
    select: { id: true },
  });

  const user = await getSessionUser();
  const sameOrg = user?.organizationId === tenant.organizationId;

  // A profile photo is seen by classmates in the community and by staff,
  // so anyone signed in to the same academy may load it. Not the public:
  // a learner's face is not course artwork.
  const portrait = user && sameOrg
    ? await db.user.findFirst({ where: { organizationId: tenant.organizationId, avatarUrl: { contains: asset.id } }, select: { id: true } })
    : null;

  // Staff see everything in their own organisation.
  let allowed =
    Boolean(branding) ||
    Boolean(artwork) ||
    Boolean(categoryArt) ||
    heroImage ||
    Boolean(portrait) ||
    Boolean(user && sameOrg && user.kind === 'STAFF');

  // Anyone, signed in or not, may see a material marked as a free preview.
  const freePreview = asset.materials.some((m) => m.isFreePreview);
  if (!allowed && freePreview) allowed = true;

  // Homework. A learner may read the files they handed in, and the files
  // of a brief that was set for them. Nobody else's hand-in: a classmate's
  // essay is not course material.
  if (!allowed && user && sameOrg) {
    const own = await db.assignmentFile.count({
      where: { assetId: asset.id, submission: { userId: user.id, organizationId: tenant.organizationId } },
    });
    if (own > 0) allowed = true;
  }
  if (!allowed && user && sameOrg) {
    const enrolments = await learnerEnrolments(tenant.organizationId, user.id);
    const clauses = assignmentsWhereFor(enrolments);
    if (clauses.length) {
      const brief = await db.assignmentAttachment.count({
        where: {
          assetId: asset.id,
          assignment: { organizationId: tenant.organizationId, status: 'PUBLISHED', deletedAt: null, OR: clauses },
        },
      });
      if (brief > 0) allowed = true;
    }
  }

  // Otherwise the learner must be enrolled in a course that uses this file, or
  // in a batch whose recording it is.
  if (!allowed && user && sameOrg) {
    const materialIds = asset.materials.map((m) => m.id);

    const [places, enrolments, viaRecording] = await Promise.all([
      // Where in the curriculum this file sits, so a drip rule or a hidden
      // section can be applied to the URL and not only to the page that links it.
      materialIds.length
        ? db.material.findMany({
            where: { id: { in: materialIds } },
            select: {
              id: true,
              sectionId: true,
              section: {
                select: {
                  isVisible: true,
                  module: { select: { id: true, courses: { select: { courseId: true } } } },
                },
              },
            },
          })
        : Promise.resolve([]),
      materialIds.length
        ? db.enrollment.findMany({
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
            select: {
              batchId: true,
              createdAt: true,
              product: { select: { course: { select: { id: true } } } },
            },
          })
        : Promise.resolve([]),
      db.recording.count({
        where: {
          assetId: asset.id,
          OR: [
            // In the batch whose class this was.
            { session: { batch: { enrollments: { some: { userId: user.id } } } } },
            // The learner a one-to-one class was held for.
            { session: { learnerId: user.id } },
            // Or holding a live share of it, made for this account. The
            // window and the withdrawal are enforced here as well as on the
            // page, so an expired share cannot still stream the file.
            {
              shares: {
                some: {
                  userId: user.id,
                  revokedAt: null,
                  expiresAt: { gt: new Date() },
                },
              },
            },
          ],
        },
      }),
    ]);

    for (const enrolment of enrolments) {
      const courseId = enrolment.product.course?.id;
      if (!courseId || allowed) continue;

      const gate = await curriculumGate({
        courseId,
        enrolledAt: enrolment.createdAt,
        batchId: enrolment.batchId,
      });

      allowed = places.some(
        (place) =>
          place.section.isVisible &&
          place.section.module.courses.some((c) => c.courseId === courseId) &&
          gate.teaches(place.section.module.id) &&
          !gate.lockOf(place.id, place.sectionId),
      );
    }

    if (!allowed) allowed = viaRecording > 0;
  }

  if (!allowed) {
    return new NextResponse(user ? 'Not available on your enrolment yet' : 'Sign in to view this', {
      status: user ? 403 : 401,
    });
  }

  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const downloadAllowed = asset.materials.some((m) => m.isDownloadable);

  // A ninety-minute class outlives a five-minute link, and the player would stall
  // on the first seek past the expiry. Media gets two hours; everything else stays
  // short, because a leaked document link is worth more to a leaker than a stream.
  const streaming = asset.type === 'VIDEO' || asset.type === 'AUDIO';

  const url = readUrlFor(asset.storageKey, {
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

  // The redirect itself is never cached, because it is the answer to "may this
  // person see this file". Only its destination is cacheable.
  //
  // Public course artwork is the exception, and it has to be: a catalogue of
  // sixty cards would otherwise be sixty permission checks against the database
  // on every single page view. The answer there does not depend on who is
  // asking, so it can be held at the edge. Two minutes is comfortably inside
  // the five-minute life of the link it points at.
  const publicArtwork = (Boolean(artwork) || Boolean(categoryArt) || heroImage) && !streaming;

  return redirectResponse(url, {
    status: 302,
    headers: {
      'Cache-Control': publicArtwork
        ? 'public, max-age=60, s-maxage=120'
        : 'private, no-store',
    },
  });
}
