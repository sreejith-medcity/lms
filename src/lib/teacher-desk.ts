import { db } from '@/lib/db';
import { activeStaffWhere } from '@/lib/scope-rules';

/**
 * The teacher's day, in five numbers and two lists: today's classes,
 * registers still to confirm, mark sheets in draft, sheets the Branch Head
 * sent back, sheets waiting on approval, and homework handed in that they
 * have not yet verified. Everything is theirs by assignment, today, by the
 * same rule the scope uses, so a batch whose assignment ended last week is
 * not on the desk.
 */

export interface TeacherDesk {
  batchIds: string[];
  today: { id: string; title: string; startsAt: Date; endsAt: Date; status: string; batch: string; registered: boolean }[];
  registersWaiting: { id: string; title: string; startsAt: Date; batch: string }[];
  sheets: { drafts: number; returned: number; awaiting: number; returnedList: { id: string; title: string; batch: string; reason: string | null }[] };
  homeworkToVerify: number;
}

export async function teacherDesk(organizationId: string, userId: string, now: Date, dayStart: Date, dayEnd: Date): Promise<TeacherDesk> {
  const rows = await db.batchStaff.findMany({
    where: { userId, batch: { organizationId, deletedAt: null }, ...activeStaffWhere(now) },
    select: { batchId: true },
  });
  const batchIds = Array.from(new Set(rows.map((r) => r.batchId)));
  if (batchIds.length === 0) return { batchIds, today: [], registersWaiting: [], sheets: { drafts: 0, returned: 0, awaiting: 0, returnedList: [] }, homeworkToVerify: 0 };

  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const [today, waiting, drafts, returned, awaiting, homework] = await Promise.all([
    db.liveSession.findMany({
      where: { organizationId, batchId: { in: batchIds }, isHoliday: false, status: { not: 'CANCELLED' }, startsAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, registerSubmittedAt: true, batch: { select: { name: true } } },
    }),
    db.liveSession.findMany({
      where: { organizationId, batchId: { in: batchIds }, isHoliday: false, status: { in: ['COMPLETED', 'LIVE'] }, endsAt: { gte: weekAgo, lte: now }, registerSubmittedAt: null },
      orderBy: { startsAt: 'desc' },
      take: 10,
      select: { id: true, title: true, startsAt: true, batch: { select: { name: true } } },
    }),
    db.markSheet.count({ where: { organizationId, batchId: { in: batchIds }, status: 'DRAFT', supersededById: null } }),
    db.markSheet.findMany({
      where: { organizationId, batchId: { in: batchIds }, status: 'RETURNED' },
      orderBy: { decidedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, returnReason: true, batch: { select: { name: true } } },
    }),
    db.markSheet.count({ where: { organizationId, batchId: { in: batchIds }, status: 'SUBMITTED' } }),
    db.assignmentSubmission.count({ where: { organizationId, status: 'SUBMITTED', verification: null, assignment: { batchId: { in: batchIds } } } }),
  ]);

  return {
    batchIds,
    today: today.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, batch: s.batch?.name ?? '', registered: s.registerSubmittedAt !== null })),
    registersWaiting: waiting.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, batch: s.batch?.name ?? '' })),
    sheets: { drafts, returned: returned.length, awaiting, returnedList: returned.map((r) => ({ id: r.id, title: r.title, batch: r.batch.name, reason: r.returnReason })) },
    homeworkToVerify: homework,
  };
}
