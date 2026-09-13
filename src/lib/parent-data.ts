import { db } from '@/lib/db';
import { balanceOf } from '@/lib/dues';
import { summariseAttendance, summariseMarks, type AttendanceSummary } from '@/lib/parents';
import { isOpen } from '@/lib/misc-fees';

/**
 * What the parent view reads for one child. Read-only by construction:
 * nothing in here writes, and every query names the academy and the child.
 */

const DAY_MS = 864e5;

export interface ChildOverview {
  attendance: AttendanceSummary;
  feesOpenPaise: number;
  feesOverduePaise: number;
  nextClassAt: Date | null;
  latestMark: { title: string; scorePercent: number | null; passed: boolean | null } | null;
}

/** The one-line figures for the children list. */
export async function childOverview(organizationId: string, childId: string, now = new Date()): Promise<ChildOverview> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [attendance, enrolments, charges, attempts, batchIds] = await Promise.all([
    db.attendance.findMany({
      where: { userId: childId, session: { organizationId, startsAt: { gte: since, lte: now }, status: { in: ['COMPLETED', 'LIVE'] } } },
      select: { status: true, session: { select: { startsAt: true } } },
    }),
    db.enrollment.findMany({
      where: { organizationId, userId: childId },
      select: { instalments: { select: { amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } } },
    }),
    db.miscFee.findMany({ where: { organizationId, userId: childId, status: 'PENDING' }, select: { amountPaise: true, dueDate: true, status: true } }),
    db.attempt.findFirst({
      where: { userId: childId, status: { in: ['SUBMITTED', 'EVALUATED'] }, assessment: { organizationId } },
      orderBy: { submittedAt: 'desc' },
      select: { scorePercent: true, passed: true, assessment: { select: { title: true } } },
    }),
    db.enrollment.findMany({ where: { organizationId, userId: childId, status: { in: ['REGISTERED', 'ENROLLED', 'ON_LEAVE'] }, batchId: { not: null } }, select: { batchId: true } }),
  ]);

  let feesOpenPaise = 0;
  let feesOverduePaise = 0;
  for (const e of enrolments) {
    for (const i of e.instalments) {
      const bal = balanceOf(i);
      if (bal <= 0) continue;
      feesOpenPaise += bal;
      if (i.dueDate.getTime() < now.getTime()) feesOverduePaise += bal;
    }
  }
  for (const c of charges) {
    if (!isOpen(c)) continue;
    feesOpenPaise += c.amountPaise;
    if (c.dueDate && c.dueDate.getTime() < now.getTime()) feesOverduePaise += c.amountPaise;
  }

  const ids = batchIds.map((b) => b.batchId).filter((x): x is string => Boolean(x));
  const next = await db.liveSession.findFirst({
    where: { organizationId, status: 'SCHEDULED', startsAt: { gte: now }, OR: [{ batchId: { in: ids } }, { learnerId: childId }] },
    orderBy: { startsAt: 'asc' },
    select: { startsAt: true },
  });

  return {
    attendance: summariseAttendance(attendance.map((a) => ({ status: a.status, startsAt: a.session.startsAt }))),
    feesOpenPaise,
    feesOverduePaise,
    nextClassAt: next?.startsAt ?? null,
    latestMark: attempts ? { title: attempts.assessment.title, scorePercent: attempts.scorePercent, passed: attempts.passed } : null,
  };
}

/** Everything on the child's page. */
export async function childDetail(organizationId: string, childId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);

  const enrolments = await db.enrollment.findMany({
    where: { organizationId, userId: childId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      progressPercent: true,
      createdAt: true,
      batchId: true,
      product: { select: { title: true } },
      batch: { select: { name: true } },
      branch: { select: { name: true } },
      instalments: { orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } },
    },
  });
  const batchIds = enrolments.map((e) => e.batchId).filter((x): x is string => Boolean(x));

  const [attendance, upcoming, charges, attempts, reportCards, receipts] = await Promise.all([
    db.attendance.findMany({
      where: { userId: childId, session: { organizationId, startsAt: { gte: since, lte: now }, status: { in: ['COMPLETED', 'LIVE'] } } },
      orderBy: { session: { startsAt: 'desc' } },
      take: 60,
      select: { status: true, minutesPresent: true, session: { select: { id: true, title: true, startsAt: true, batch: { select: { name: true } } } } },
    }),
    db.liveSession.findMany({
      where: { organizationId, status: 'SCHEDULED', startsAt: { gte: now, lte: weekAhead }, OR: [{ batchId: { in: batchIds } }, { learnerId: childId }] },
      orderBy: { startsAt: 'asc' },
      take: 12,
      select: { id: true, title: true, startsAt: true, endsAt: true, batch: { select: { name: true } } },
    }),
    db.miscFee.findMany({
      where: { organizationId, userId: childId, status: { in: ['PENDING', 'PAID'] } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: 20,
      select: { id: true, label: true, amountPaise: true, dueDate: true, status: true, paidAt: true, enrollment: { select: { product: { select: { title: true } } } } },
    }),
    db.attempt.findMany({
      where: { userId: childId, status: { in: ['SUBMITTED', 'EVALUATED'] }, assessment: { organizationId } },
      orderBy: { submittedAt: 'desc' },
      take: 30,
      select: { id: true, scorePercent: true, passed: true, submittedAt: true, status: true, assessment: { select: { title: true, passPercent: true } } },
    }),
    db.reportCard.findMany({
      where: { organizationId, userId: childId },
      orderBy: { issuedAt: 'desc' },
      take: 12,
      select: { id: true, title: true, issuedAt: true, periodFrom: true, periodTo: true, remark: true, enrollment: { select: { product: { select: { title: true } } } } },
    }),
    db.payment.findMany({
      where: { organizationId, userId: childId, status: 'CAPTURED', receiptNo: { not: null } },
      orderBy: { capturedAt: 'desc' },
      take: 12,
      select: { id: true, receiptNo: true, amountPaise: true, capturedAt: true, createdAt: true, method: true, raw: true },
    }),
  ]);

  const marks = attempts.map((a) => ({ id: a.id, title: a.assessment.title, scorePercent: a.status === 'EVALUATED' ? a.scorePercent : null, passed: a.status === 'EVALUATED' ? a.passed : null, submittedAt: a.submittedAt, passPercent: a.assessment.passPercent, marked: a.status === 'EVALUATED' }));

  return {
    enrolments,
    attendance,
    attendanceSummary: summariseAttendance(attendance.map((a) => ({ status: a.status, startsAt: a.session.startsAt }))),
    upcoming,
    charges,
    marks,
    marksSummary: summariseMarks(marks),
    reportCards,
    receipts,
  };
}
