import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { childOf } from '@/lib/parent-session';
import { childDetail } from '@/lib/parent-data';
import { attendanceNote } from '@/lib/parents';

export const dynamic = 'force-dynamic';

/** GET → one child: courses, this week's classes, attendance (90 days), open fees, marks, report cards. */
export async function GET(request: Request, { params }: { params: Promise<{ childId: string }> }) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { childId } = await params;
  const child = await childOf(ctx.tenant.organizationId, ctx.parent.contact, childId);
  if (!child) return fail('access_removed', 'This child is no longer on your account.', 404);
  const d = await childDetail(ctx.tenant.organizationId, child.id);
  return ok({
    child: { id: child.id, name: child.name, registrationNo: child.registrationNo, avatarUrl: child.avatarUrl },
    enrolments: d.enrolments.map((e) => ({ id: e.id, status: e.status, progressPercent: e.progressPercent, course: e.product.title, batch: e.batch?.name ?? null, branch: e.branch.name, joinedAt: e.createdAt.toISOString(), instalments: e.instalments.map((i) => ({ ...i, dueDate: i.dueDate.toISOString(), paidAt: i.paidAt?.toISOString() ?? null })) })),
    attendance: { summary: { ...d.attendanceSummary, note: attendanceNote(d.attendanceSummary) }, rows: d.attendance.map((a) => ({ sessionId: a.session.id, title: a.session.title, batch: a.session.batch?.name ?? null, startsAt: a.session.startsAt.toISOString(), status: a.status, minutesPresent: a.minutesPresent })) },
    upcoming: d.upcoming.map((s) => ({ id: s.id, title: s.title, batch: s.batch?.name ?? null, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    charges: d.charges,
    marks: d.marks,
    marksSummary: d.marksSummary,
    reportCards: d.reportCards,
    receipts: d.receipts,
  });
}
