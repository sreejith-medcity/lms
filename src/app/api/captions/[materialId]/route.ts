import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { entitledToLesson } from '@/lib/lesson-entitlement';
import { toVtt } from '@/lib/captions';
import { segmentsOf } from '@/lib/transcripts';

export const dynamic = 'force-dynamic';

/**
 * The captions for a lesson, as WebVTT for the player's <track>. Reached
 * by material rather than by asset, so the check is the lesson's own:
 * enrolled, released, or staff.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  const tenant = await getTenantContext();
  if (!tenant) return new NextResponse('Not found', { status: 404 });

  const user = await getSessionUser();
  if (!user) return new NextResponse('Sign in to view this', { status: 401 });

  if (user.kind !== 'STAFF' || user.organizationId !== tenant.organizationId) {
    try {
      await entitledToLesson(materialId);
    } catch {
      return new NextResponse('Not available on your enrolment yet', { status: 403 });
    }
  }

  const material = await db.material.findFirst({
    where: { id: materialId, asset: { organizationId: tenant.organizationId } },
    select: { asset: { select: { transcript: { select: { segments: true, language: true } } } } },
  });
  const transcript = material?.asset?.transcript;
  if (!transcript) return new NextResponse('No captions', { status: 404 });

  return new NextResponse(toVtt(segmentsOf(transcript.segments)), {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Content-Language': transcript.language,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
