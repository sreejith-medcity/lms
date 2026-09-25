import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { examFormat } from '@/lib/exams/registry';
import { renderResultPdf } from '@/lib/exams/result-pdf';
import { logoBytes } from '@/lib/report-card-serve';

export const dynamic = 'force-dynamic';

/**
 * A marked paper as a PDF, for the candidate to keep or show a teacher.
 * Only a whole paper sat in exam mode, once every part has its mark: a
 * practice run or a single part is not a result to print.
 */
export async function GET(_: Request, { params }: { params: Promise<{ sittingId: string }> }) {
  const { sittingId } = await params;
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant || !user) return new NextResponse('Not found', { status: 404 });
  const s = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, include: { user: { select: { name: true } } } });
  if (!s) return new NextResponse('Not found', { status: 404 });
  const staff = user.kind === 'STAFF' && can(user.permissions, 'submission.view_submissions', 'view');
  if (s.userId !== user.id && !staff) return new NextResponse('Not found', { status: 404 });
  const format = examFormat(s.formatCode);
  if (!format || s.status !== 'EVALUATED' || s.mode !== 'exam' || s.sectionId) return new NextResponse('Only a whole paper sat in exam mode, once marked, has a result to print.', { status: 409 });

  const org = await db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true, brandColor: true, logoUrl: true } });
  const points = (s.points ?? {}) as Record<string, number | null>;
  const conditions = (Array.isArray(s.conditions) ? s.conditions : []) as { name: string; met: boolean; got: number; min: number; max: number }[];
  const bytes = await renderResultPdf({
    academy: org?.name ?? tenant.name,
    accentHex: org?.brandColor ?? '#322046',
    logo: await logoBytes(tenant.organizationId, org?.logoUrl ?? null),
    candidate: s.user.name,
    test: format.name,
    subtitle: format.subtitle,
    date: (s.submittedAt ?? s.startedAt).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: tenant.timezone }),
    mode: 'exam mode, on the clock',
    reference: `${s.drawCode}-${s.id.slice(-6).toUpperCase()}`,
    total: s.total,
    maxPoints: s.maxPoints,
    passed: s.passed,
    modules: format.scoring.modules.map((m) => ({ name: m.name, points: points[m.id] ?? null, max: m.max })),
    conditions,
    note: `A practice paper in the format of the ${format.name} exam, set and marked by ${org?.name ?? 'the academy'}. Objective parts are counted from the answer key; writing and speaking are marked against the exam's criteria by a model and checked by tutors. This is not an official certificate and is not issued by, or connected with, the exam provider; the score is an indication of where the candidate stands.`,
  });
  const file = `${format.slug}-result-${s.drawCode.toLowerCase()}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}"`, 'Cache-Control': 'private, no-store' },
  });
}
