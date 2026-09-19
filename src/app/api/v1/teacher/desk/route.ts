import { apiStaff } from '@/lib/api/staff';
import { fail, ok } from '@/lib/api/http';
import { dayEnd, dayStart, todayKey } from '@/lib/clock';
import { teacherDesk } from '@/lib/teacher-desk';
import { batchWhere, staffScope } from '@/lib/scope';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET → the teacher's day: today's classes with whether the register is
 * confirmed, registers of the last week still waiting, mark sheets in
 * draft, returned and awaiting approval, homework to verify, and the
 * batches assigned today. The first screen the app opens for staff.
 */
export async function GET(request: Request) {
  const ctx = await apiStaff(request);
  if (!ctx) return fail('unauthorised', 'Sign in as a member of staff.', 401);
  const { tenant, user } = ctx;
  const now = new Date();
  const key = todayKey(tenant.timezone);
  const scope = await staffScope(user);
  const [desk, batches] = await Promise.all([
    teacherDesk(tenant.organizationId, user.id, now, dayStart(key, tenant.timezone), dayEnd(key, tenant.timezone)),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null, status: { in: ['UPCOMING', 'ACTIVE'] }, ...batchWhere(scope) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true, level: true, mode: true, branch: { select: { name: true } }, course: { select: { product: { select: { title: true } } } }, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } } } } } },
    }),
  ]);
  return ok({
    date: key,
    today: desk.today.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: s.status, batch: s.batch, registerConfirmed: s.registered })),
    registersWaiting: desk.registersWaiting.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt.toISOString(), batch: s.batch })),
    markSheets: { drafts: desk.sheets.drafts, returned: desk.sheets.returned, awaitingApproval: desk.sheets.awaiting, returnedList: desk.sheets.returnedList },
    homeworkToVerify: desk.homeworkToVerify,
    batches: batches.map((b) => ({ id: b.id, name: b.name, status: b.status, level: b.level, mode: b.mode, branch: b.branch.name, course: b.course.product.title, learners: b._count.enrollments })),
    canEditRegister: user.permissions['scheduling.sessions']?.edit ?? false,
  });
}
