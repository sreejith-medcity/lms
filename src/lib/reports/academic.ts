import { db } from '@/lib/db';
import { attendanceFigure, type Mark } from '@/lib/progress-rules';
import type { ReportDef } from './types';

/**
 * What a Branch Head and Head Office asked for: whether registers are
 * being kept, whether results are moving through approval, how learners
 * are doing by batch, and what is owed. Every one honours the person's
 * branch scope (`ctx.branchIds`), so a Branch Head's export holds their
 * branch and never the academy.
 */

function branchScope(branchIds: string[] | null | undefined) {
  return branchIds ? { branchId: { in: branchIds } } : {};
}

export const academicReports: ReportDef[] = [
  {
    id: 'attendance-completion',
    title: 'Registers: kept, missing, exceptions',
    category: 'progress',
    question: 'Which batches are keeping their registers, and where are absences piling up?',
    definitions: [
      ['Classes held', 'Completed classes in the window, holidays and cancellations excluded.'],
      ['Registers confirmed', 'Classes whose register a teacher confirmed, or that the platform reported fully.'],
      ['Not recorded', 'Roll places across those classes with no attendance record at all: never counted as absent.'],
      ['Absent / Late', 'Records marked so, by a teacher, the platform or the no-show check.'],
      ['Integration exceptions', 'Online classes that ended without the platform ever reporting them started.'],
    ],
    async run(ctx) {
      const sessions = await db.liveSession.findMany({
        where: { organizationId: ctx.organizationId, status: { in: ['COMPLETED', 'LIVE'] }, isHoliday: false, startsAt: { gte: ctx.since, lte: new Date() }, batchId: { not: null }, batch: branchScope(ctx.branchIds) },
        select: {
          batchId: true,
          status: true,
          providerMeetingId: true,
          registerSubmittedAt: true,
          batch: { select: { name: true, mode: true, branch: { select: { name: true } }, _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } } } } } } },
          attendances: { select: { status: true } },
        },
      });
      const byBatch = new Map<string, { name: string; branch: string; held: number; confirmed: number; roll: number; recorded: number; absent: number; late: number; exceptions: number }>();
      for (const s of sessions) {
        const key = s.batchId as string;
        const row = byBatch.get(key) ?? { name: s.batch?.name ?? '', branch: s.batch?.branch.name ?? '', held: 0, confirmed: 0, roll: 0, recorded: 0, absent: 0, late: 0, exceptions: 0 };
        row.held += 1;
        row.roll += s.batch?._count.enrollments ?? 0;
        row.recorded += s.attendances.length;
        row.absent += s.attendances.filter((a) => a.status === 'ABSENT').length;
        row.late += s.attendances.filter((a) => a.status === 'LATE').length;
        if (s.registerSubmittedAt || (s.attendances.length >= (s.batch?._count.enrollments ?? 0) && s.attendances.length > 0)) row.confirmed += 1;
        // An online class that ended with a meeting id but never went LIVE:
        // the platform said nothing, so nobody could be marked from it.
        if ((s.batch?.mode === 'ONLINE' || s.batch?.mode === 'HYBRID') && s.status === 'COMPLETED' && s.providerMeetingId && s.attendances.length === 0) row.exceptions += 1;
        byBatch.set(key, row);
      }
      const rows = [...byBatch.values()].sort((a, b) => b.held - b.confirmed - (a.held - a.confirmed));
      return {
        columns: [
          { key: 'batch', label: 'Batch' },
          { key: 'branch', label: 'Branch' },
          { key: 'held', label: 'Classes held', numeric: true },
          { key: 'confirmed', label: 'Registers confirmed', numeric: true },
          { key: 'missing', label: 'Registers missing', numeric: true },
          { key: 'unrecorded', label: 'Not recorded', numeric: true },
          { key: 'absent', label: 'Absent', numeric: true },
          { key: 'late', label: 'Late', numeric: true },
          { key: 'exceptions', label: 'Integration exceptions', numeric: true },
        ],
        rows: rows.map((r) => [r.name, r.branch, r.held, r.confirmed, r.held - r.confirmed, Math.max(0, r.roll - r.recorded), r.absent, r.late, r.exceptions]),
        stats: [
          { label: 'Classes held', value: String(sessions.length) },
          { label: 'Registers missing', value: String(rows.reduce((n, r) => n + (r.held - r.confirmed), 0)) },
          { label: 'Integration exceptions', value: String(rows.reduce((n, r) => n + r.exceptions, 0)) },
        ],
        note: 'Sorted by registers missing. A missing register means nobody on that class is absent yet either; the teacher has not said.',
      };
    },
  },
  {
    id: 'academic-monitoring',
    title: 'Results through approval',
    category: 'progress',
    question: 'Are marks being entered, and are they getting approved?',
    definitions: [
      ['Drafts', 'Mark sheets started and not yet submitted.'],
      ['Waiting', 'Submitted and not yet decided; the oldest wait is shown.'],
      ['Returned', 'Sent back to the teacher for correction and not yet resubmitted.'],
      ['Published', 'Approved in the window.'],
      ['Homework backlog', 'Hand-ins in the window not yet verified by a teacher.'],
    ],
    async run(ctx) {
      const [sheets, backlog] = await Promise.all([
        db.markSheet.findMany({
          where: { organizationId: ctx.organizationId, updatedAt: { gte: ctx.since }, batch: branchScope(ctx.branchIds) },
          select: { status: true, submittedAt: true, publishedAt: true, batch: { select: { id: true, name: true, branch: { select: { name: true } } } } },
        }),
        db.assignmentSubmission.findMany({
          where: { organizationId: ctx.organizationId, submittedAt: { gte: ctx.since }, verification: null, status: { not: 'RETURNED' }, assignment: { batch: ctx.branchIds ? branchScope(ctx.branchIds) : undefined } },
          select: { assignment: { select: { batchId: true, batch: { select: { name: true, branch: { select: { name: true } } } } } } },
        }),
      ]);
      const now = Date.now();
      const by = new Map<string, { name: string; branch: string; drafts: number; waiting: number; oldest: number; returned: number; published: number; backlog: number }>();
      const rowFor = (id: string, name: string, branch: string) => {
        const r = by.get(id) ?? { name, branch, drafts: 0, waiting: 0, oldest: 0, returned: 0, published: 0, backlog: 0 };
        by.set(id, r);
        return r;
      };
      for (const s of sheets) {
        const r = rowFor(s.batch.id, s.batch.name, s.batch.branch.name);
        if (s.status === 'DRAFT') r.drafts += 1;
        else if (s.status === 'SUBMITTED') {
          r.waiting += 1;
          if (s.submittedAt) r.oldest = Math.max(r.oldest, Math.round((now - s.submittedAt.getTime()) / 864e5));
        } else if (s.status === 'RETURNED') r.returned += 1;
        else if (s.status === 'PUBLISHED' && s.publishedAt && s.publishedAt >= ctx.since) r.published += 1;
      }
      for (const b of backlog) {
        if (!b.assignment.batchId || !b.assignment.batch) continue;
        rowFor(b.assignment.batchId, b.assignment.batch.name, b.assignment.batch.branch.name).backlog += 1;
      }
      const rows = [...by.values()].sort((a, b) => b.waiting - a.waiting || b.oldest - a.oldest);
      return {
        columns: [
          { key: 'batch', label: 'Batch' },
          { key: 'branch', label: 'Branch' },
          { key: 'drafts', label: 'Drafts', numeric: true },
          { key: 'waiting', label: 'Waiting', numeric: true },
          { key: 'oldest', label: 'Oldest wait (days)', numeric: true },
          { key: 'returned', label: 'Returned', numeric: true },
          { key: 'published', label: 'Published', numeric: true },
          { key: 'backlog', label: 'Homework backlog', numeric: true },
        ],
        rows: rows.map((r) => [r.name, r.branch, r.drafts, r.waiting, r.waiting ? r.oldest : null, r.returned, r.published, r.backlog]),
        stats: [
          { label: 'Waiting for approval', value: String(rows.reduce((n, r) => n + r.waiting, 0)) },
          { label: 'Published', value: String(rows.reduce((n, r) => n + r.published, 0)), sub: 'in the window' },
          { label: 'Homework to verify', value: String(backlog.length) },
        ],
      };
    },
  },
  {
    id: 'progress-by-batch',
    title: 'Progress by batch',
    category: 'progress',
    question: 'How is each batch doing on attendance, published results and homework?',
    definitions: [
      ['Attendance', 'Present and late over completed classes with a final record, across the roll. Not recorded is left out.'],
      ['Tests average', 'Mean of published, current mark sheet lines that were scored; absent and not assessed left out.'],
      ['Pass rate', 'Scored lines marked passed over scored lines.'],
      ['Homework complete', 'Latest hand-in verified complete over hand-ins looked at.'],
    ],
    async run(ctx) {
      const batches = await db.batch.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'COMPLETED'] }, ...branchScope(ctx.branchIds) },
        select: {
          id: true,
          name: true,
          level: true,
          branch: { select: { name: true } },
          course: { select: { product: { select: { title: true } } } },
          enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } }, select: { userId: true } },
          sessions: { where: { status: 'COMPLETED', isHoliday: false, startsAt: { gte: ctx.since, lte: new Date() } }, select: { id: true, startsAt: true, attendances: { select: { userId: true, status: true } } } },
          markSheets: { where: { status: 'PUBLISHED', supersededById: null, testDate: { gte: ctx.since } }, select: { entries: { select: { outcome: true, marks: true, passed: true }, }, maxMarks: true } },
        },
        take: 300,
      });
      const batchIds = batches.map((b) => b.id);
      const hw = await db.assignmentSubmission.findMany({
        where: { organizationId: ctx.organizationId, verification: { not: null }, verifiedAt: { gte: ctx.since }, assignment: { batchId: { in: batchIds } } },
        select: { verification: true, assignment: { select: { batchId: true } } },
      });
      const hwBy = new Map<string, { looked: number; complete: number }>();
      for (const h of hw) {
        const key = h.assignment.batchId as string;
        const r = hwBy.get(key) ?? { looked: 0, complete: 0 };
        r.looked += 1;
        if (h.verification === 'COMPLETE') r.complete += 1;
        hwBy.set(key, r);
      }
      const rows = batches.map((b) => {
        const roll = b.enrollments.map((e) => e.userId);
        const figures = roll.map((userId) => attendanceFigure({ sessions: b.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, status: (s.attendances.find((a) => a.userId === userId)?.status as Mark | undefined) ?? null })) }));
        const withData = figures.filter((f) => f.percent !== null);
        const attendance = withData.length ? Math.round(withData.reduce((n, f) => n + (f.percent as number), 0) / withData.length) : null;
        const scored = b.markSheets.flatMap((s) => s.entries.filter((e) => e.outcome === 'SCORED' && e.marks !== null).map((e) => ({ percent: ((e.marks as number) / s.maxMarks) * 100, passed: e.passed })));
        const average = scored.length ? Math.round((scored.reduce((n, e) => n + e.percent, 0) / scored.length) * 10) / 10 : null;
        const passRate = scored.length ? Math.round((scored.filter((e) => e.passed).length / scored.length) * 100) : null;
        const h = hwBy.get(b.id);
        return [
          b.name,
          b.branch.name,
          `${b.course.product.title}${b.level ? ` · ${b.level}` : ''}`,
          roll.length,
          b.sessions.length,
          attendance !== null ? `${attendance}%` : '—',
          average !== null ? `${average}%` : '—',
          passRate !== null ? `${passRate}%` : '—',
          h ? `${h.complete} of ${h.looked}` : '—',
        ];
      });
      return {
        columns: [
          { key: 'batch', label: 'Batch' },
          { key: 'branch', label: 'Branch' },
          { key: 'course', label: 'Course and level' },
          { key: 'roll', label: 'Learners', numeric: true },
          { key: 'held', label: 'Classes held', numeric: true },
          { key: 'attendance', label: 'Attendance', numeric: true },
          { key: 'average', label: 'Tests average', numeric: true },
          { key: 'pass', label: 'Pass rate', numeric: true },
          { key: 'homework', label: 'Homework complete', numeric: true },
        ],
        rows,
        note: 'A dash means there is nothing to count yet, not a zero. Drill into a batch from its classroom page.',
      };
    },
  },
  {
    id: 'fees-by-branch',
    title: 'Fees owed, by branch and batch',
    category: 'sales',
    question: 'What is owed, what is overdue, and what falls due next?',
    definitions: [
      ['Agreed', 'Sum of instalment amounts on enrolments in these batches.'],
      ['Paid', 'Confirmed payments against those instalments.'],
      ['Outstanding', 'Agreed less paid.'],
      ['Overdue', 'The outstanding part of instalments whose due date has passed.'],
      ['Next due', 'The earliest unpaid instalment date across the batch.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const enrolments = await db.enrollment.findMany({
        where: { organizationId: ctx.organizationId, status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] }, instalments: { some: {} }, ...branchScope(ctx.branchIds) },
        select: { batchId: true, batch: { select: { name: true } }, branch: { select: { name: true } }, instalments: { select: { amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } } },
        take: 5000,
      });
      const now = Date.now();
      const by = new Map<string, { batch: string; branch: string; agreed: number; paid: number; overdue: number; next: Date | null; learners: number }>();
      for (const e of enrolments) {
        const key = e.batchId ?? `none:${e.branch.name}`;
        const r = by.get(key) ?? { batch: e.batch?.name ?? 'No batch', branch: e.branch.name, agreed: 0, paid: 0, overdue: 0, next: null, learners: 0 };
        r.learners += 1;
        for (const i of e.instalments) {
          r.agreed += i.amountPaise;
          r.paid += i.paidPaise;
          const bal = i.amountPaise - i.paidPaise;
          if (bal > 0) {
            if (i.dueDate.getTime() < now) r.overdue += bal;
            else if (!r.next || i.dueDate < r.next) r.next = i.dueDate;
          }
        }
        by.set(key, r);
      }
      const money = (p: number) => `${ctx.currency} ${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      const rows = [...by.values()].sort((a, b) => b.overdue - a.overdue);
      return {
        columns: [
          { key: 'batch', label: 'Batch' },
          { key: 'branch', label: 'Branch' },
          { key: 'learners', label: 'Learners', numeric: true },
          { key: 'agreed', label: 'Agreed', numeric: true },
          { key: 'paid', label: 'Paid', numeric: true },
          { key: 'outstanding', label: 'Outstanding', numeric: true },
          { key: 'overdue', label: 'Overdue', numeric: true },
          { key: 'next', label: 'Next due' },
        ],
        rows: rows.map((r) => [r.batch, r.branch, r.learners, money(r.agreed), money(r.paid), money(r.agreed - r.paid), money(r.overdue), r.next ? r.next.toISOString().slice(0, 10) : '—']),
        stats: [
          { label: 'Outstanding', value: money(rows.reduce((n, r) => n + r.agreed - r.paid, 0)) },
          { label: 'Overdue', value: money(rows.reduce((n, r) => n + r.overdue, 0)) },
        ],
        note: 'Instalment plans only; charges beyond the course fee are on the fees screen. Sorted by overdue.',
      };
    },
  },
];
