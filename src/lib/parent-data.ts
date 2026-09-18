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
    // Only what the Branch Head has published; a paper still being marked
    // or waiting for approval does not exist from here.
    db.markSheetEntry.findFirst({
      where: { userId: childId, sheet: { organizationId, status: 'PUBLISHED', supersededById: null } },
      orderBy: { sheet: { publishedAt: 'desc' } },
      select: { outcome: true, marks: true, passed: true, sheet: { select: { title: true, maxMarks: true } } },
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
    latestMark: attempts
      ? { title: attempts.sheet.title, scorePercent: attempts.outcome === 'SCORED' && attempts.marks !== null ? Math.round((attempts.marks / attempts.sheet.maxMarks) * 1000) / 10 : null, passed: attempts.passed }
      : null,
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
    db.markSheetEntry.findMany({
      where: { userId: childId, sheet: { organizationId, status: 'PUBLISHED', supersededById: null } },
      orderBy: { sheet: { testDate: 'desc' } },
      take: 40,
      select: { id: true, outcome: true, marks: true, grade: true, passed: true, remark: true, sheet: { select: { id: true, title: true, category: true, skill: true, level: true, testDate: true, maxMarks: true, passPercent: true, publishedAt: true, version: true, assetIds: true } } },
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

  const marks = attempts.map((a) => ({
    id: a.id,
    title: a.sheet.title,
    category: a.sheet.category,
    skill: a.sheet.skill,
    level: a.sheet.level,
    outcome: a.outcome,
    marks: a.outcome === 'SCORED' ? a.marks : null,
    maxMarks: a.sheet.maxMarks,
    scorePercent: a.outcome === 'SCORED' && a.marks !== null ? Math.round((a.marks / a.sheet.maxMarks) * 1000) / 10 : null,
    grade: a.grade,
    passed: a.outcome === 'SCORED' ? a.passed : null,
    // A remark on a published sheet passed the same gate as the mark.
    remark: a.remark,
    submittedAt: a.sheet.testDate,
    publishedAt: a.sheet.publishedAt,
    passPercent: a.sheet.passPercent,
    marked: a.outcome === 'SCORED',
    corrected: a.sheet.version > 1,
    files: a.sheet.assetIds,
  }));

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
