import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { childOf } from '@/lib/parent-session';
import { courseProgress } from '@/lib/progress-data';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET ?enrollmentId= → the academics view: attendance figure, tests with the retest rule applied, trends, homework, rating, level progress. Defaults to the newest enrolment. */
export async function GET(request: Request, { params }: { params: Promise<{ childId: string }> }) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { childId } = await params;
  const child = await childOf(ctx.tenant.organizationId, ctx.parent.contact, childId);
  if (!child) return fail('access_removed', 'This child is no longer on your account.', 404);
  const wanted = new URL(request.url).searchParams.get('enrollmentId');
  const enrolments = await db.enrollment.findMany({ where: { organizationId: ctx.tenant.organizationId, userId: child.id }, orderBy: { createdAt: 'desc' }, select: { id: true, product: { select: { title: true } } } });
  const pick = enrolments.find((e) => e.id === wanted) ?? enrolments[0];
  if (!pick) return ok({ enrolments: [], progress: null });
  const progress = await courseProgress(ctx.tenant.organizationId, child.id, pick.id);
  return ok({ enrolments: enrolments.map((e) => ({ id: e.id, course: e.product.title })), enrollmentId: pick.id, progress });
}
