import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { dayKey } from '@/lib/clock';
import type { ReportDef } from './types';

/**
 * The five that did not fit a category cleanly, and are asked for anyway.
 */

export const extraReports: ReportDef[] = [
  {
    id: 'payment-methods',
    title: 'How people paid',
    category: 'sales',
    question: 'How much of this is cash, and how much came through the gateway?',
    definitions: [
      ['Method', 'The gateway or the counter: Razorpay, cash, cheque, or a manual entry by staff.'],
      ['Collected', 'Captured payments only. A pending cheque is not collected until it clears.'],
    ],
    async run(ctx) {
      const payments = await db.payment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'CAPTURED',
          capturedAt: { gte: ctx.since },
        },
        select: { gateway: true, method: true, amountPaise: true },
      });

      const byMethod = new Map<string, { count: number; paise: number }>();
      for (const p of payments) {
        const key = p.gateway === 'RAZORPAY' && p.method ? `razorpay · ${p.method}` : p.gateway.toLowerCase();
        const entry = byMethod.get(key) ?? { count: 0, paise: 0 };
        entry.count += 1;
        entry.paise += p.amountPaise;
        byMethod.set(key, entry);
      }

      const total = payments.reduce((n, p) => n + p.amountPaise, 0);

      return {
        columns: [
          { key: 'method', label: 'Method' },
          { key: 'payments', label: 'Payments', numeric: true },
          { key: 'collected', label: 'Collected', numeric: true },
          { key: 'share', label: 'Share', numeric: true },
        ],
        rows: [...byMethod.entries()]
          .sort((a, b) => b[1].paise - a[1].paise)
          .map(([method, v]) => [
            method,
            v.count,
            formatMoney(v.paise, ctx.currency),
            total > 0 ? `${Math.round((v.paise / total) * 100)}%` : '—',
          ]),
        stats: [
          { label: 'Collected', value: formatMoney(total, ctx.currency), sub: `${payments.length} payments` },
        ],
      };
    },
  },

  {
    id: 'collections-vs-settled',
    title: 'Collected against settled',
    category: 'sales',
    question: 'How much of what we collected has actually reached the bank?',
    definitions: [
      ['Collected online', 'Captured gateway payments. Cash, cheque and manual entries are left out, since no gateway settles those.'],
      ['Settled', 'Of those, the ones attached to a settlement that was entered.'],
      ['Waiting', 'The difference. Not a problem on its own: gateways settle on a delay.'],
    ],
    async run(ctx) {
      const payments = await db.payment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'CAPTURED',
          capturedAt: { gte: ctx.since },
          gateway: { notIn: ['CASH', 'MANUAL', 'CHEQUE'] },
        },
        select: { amountPaise: true, capturedAt: true, settlementId: true },
      });

      const byDay = new Map<string, { collected: number; settled: number; n: number }>();
      for (const p of payments) {
        if (!p.capturedAt) continue;
        const key = dayKey(p.capturedAt, ctx.timeZone);
        const entry = byDay.get(key) ?? { collected: 0, settled: 0, n: 0 };
        entry.collected += p.amountPaise;
        entry.n += 1;
        if (p.settlementId) entry.settled += p.amountPaise;
        byDay.set(key, entry);
      }

      const collected = payments.reduce((n, p) => n + p.amountPaise, 0);
      const settled = payments
        .filter((p) => p.settlementId)
        .reduce((n, p) => n + p.amountPaise, 0);

      return {
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'payments', label: 'Payments', numeric: true },
          { key: 'collected', label: 'Collected', numeric: true },
          { key: 'settled', label: 'Settled', numeric: true },
          { key: 'waiting', label: 'Waiting', numeric: true },
        ],
        rows: [...byDay.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([day, v]) => [
            day,
            v.n,
            formatMoney(v.collected, ctx.currency),
            formatMoney(v.settled, ctx.currency),
            formatMoney(v.collected - v.settled, ctx.currency),
          ]),
        stats: [
          { label: 'Collected online', value: formatMoney(collected, ctx.currency) },
          {
            label: 'Not yet in the bank',
            value: formatMoney(collected - settled, ctx.currency),
            sub: collected > 0 ? `${Math.round(((collected - settled) / collected) * 100)}% of it` : undefined,
          },
        ],
      };
    },
  },

  {
    id: 'learner-progress',
    title: 'Every learner',
    category: 'progress',
    question: 'Where is each person up to?',
    definitions: [
      ['Progress', 'Lessons finished over the lessons that enrolment was given, as a percentage.'],
      ['Attendance', 'Classes signed into over classes held by their batch since they joined.'],
      ['Last seen', 'The most recent activity on any lesson. Blank means they have never opened one.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const enrolments = await db.enrollment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        },
        orderBy: { progressPercent: 'asc' },
        take: 1000,
        select: {
          progressPercent: true,
          status: true,
          lastActivityAt: true,
          user: { select: { id: true, name: true, email: true } },
          product: { select: { title: true } },
          batch: { select: { name: true } },
        },
      });

      const attendance = await db.attendance.groupBy({
        by: ['userId', 'status'],
        where: { session: { organizationId: ctx.organizationId } },
        _count: true,
      });

      const attendanceBy = new Map<string, { came: number; total: number }>();
      for (const a of attendance) {
        const entry = attendanceBy.get(a.userId) ?? { came: 0, total: 0 };
        entry.total += a._count;
        if (a.status === 'PRESENT' || a.status === 'LATE') entry.came += a._count;
        attendanceBy.set(a.userId, entry);
      }

      return {
        columns: [
          { key: 'learner', label: 'Learner' },
          { key: 'email', label: 'Email' },
          { key: 'course', label: 'Course' },
          { key: 'batch', label: 'Batch' },
          { key: 'state', label: 'State' },
          { key: 'progress', label: 'Progress', numeric: true },
          { key: 'attendance', label: 'Attendance', numeric: true },
          { key: 'seen', label: 'Last seen' },
        ],
        rows: enrolments.map((e) => {
          const a = attendanceBy.get(e.user.id);
          return [
            e.user.name,
            e.user.email ?? '—',
            e.product.title,
            e.batch?.name ?? '—',
            e.status.toLowerCase(),
            `${Math.round(e.progressPercent)}%`,
            a && a.total > 0 ? `${Math.round((a.came / a.total) * 100)}%` : '—',
            e.lastActivityAt ? dayKey(e.lastActivityAt, ctx.timeZone) : 'never',
          ];
        }),
        note: 'Lowest progress first, so the list opens on the people who need chasing.',
      };
    },
  },

  {
    id: 'trainer-ratings',
    title: 'How trainers are rated',
    category: 'trainer',
    question: 'What do learners say about each trainer’s classes?',
    definitions: [
      ['Rating', 'The mean star rating across every class held by batches this person is staffed on.'],
      ['Answers', 'How many ratings that average is built from. Fewer than five is an anecdote.'],
    ],
    async run(ctx) {
      const [staff, responses] = await Promise.all([
        db.batchStaff.findMany({
          where: { batch: { organizationId: ctx.organizationId, deletedAt: null } },
          select: { userId: true, batchId: true },
        }),
        db.feedbackResponse.findMany({
          where: {
            rating: { not: null },
            createdAt: { gte: ctx.since },
            session: { organizationId: ctx.organizationId },
          },
          select: { rating: true, session: { select: { batchId: true } } },
        }),
      ]);
      if (staff.length === 0) return { columns: [{ key: 'x', label: '' }], rows: [] };

      const people = await db.user.findMany({
        where: { id: { in: [...new Set(staff.map((s) => s.userId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(people.map((p) => [p.id, p.name]));

      const byBatch = new Map<string, number[]>();
      for (const r of responses) {
        if (!r.session || r.rating == null) continue;
        const list = byBatch.get(r.session.batchId) ?? [];
        list.push(r.rating);
        byBatch.set(r.session.batchId, list);
      }

      const byTrainer = new Map<string, number[]>();
      for (const s of staff) {
        const list = byTrainer.get(s.userId) ?? [];
        list.push(...(byBatch.get(s.batchId) ?? []));
        byTrainer.set(s.userId, list);
      }

      const rows = [...byTrainer.entries()]
        .filter(([, ratings]) => ratings.length > 0)
        .map(([userId, ratings]) => {
          const average = ratings.reduce((a, b) => a + b, 0) / ratings.length;
          return {
            average,
            row: [
              names.get(userId) ?? 'Unknown',
              average.toFixed(1),
              ratings.length,
              ratings.length < 5 ? 'too few to trust' : '',
            ],
          };
        })
        .sort((a, b) => b.average - a.average);

      return {
        columns: [
          { key: 'trainer', label: 'Trainer' },
          { key: 'rating', label: 'Rating', numeric: true },
          { key: 'answers', label: 'Answers', numeric: true },
          { key: 'caveat', label: '' },
        ],
        rows: rows.map((r) => r.row),
        note: 'A rating built from three answers is marked as such rather than ranked as if it were solid.',
      };
    },
  },

  {
    id: 'audit-trail',
    title: 'Who changed what',
    category: 'operations',
    question: 'What did staff actually do in here?',
    definitions: [
      ['Action', 'The recorded event. Money, access and personal data are all written down; ordinary reads are not.'],
      ['Actor', 'The staff account that did it. An impersonated session records the staff member, not the learner.'],
    ],
    async run(ctx) {
      const entries = await db.auditLog.findMany({
        where: { organizationId: ctx.organizationId, createdAt: { gte: ctx.since } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          createdAt: true,
          action: true,
          entity: true,
          entityId: true,
          actor: { select: { name: true } },
        },
      });

      return {
        columns: [
          { key: 'when', label: 'When' },
          { key: 'actor', label: 'Who' },
          { key: 'action', label: 'Did' },
          { key: 'entity', label: 'To' },
        ],
        rows: entries.map((e) => [
          dayKey(e.createdAt, ctx.timeZone),
          e.actor?.name ?? 'system',
          e.action,
          `${e.entity}${e.entityId ? ` ${e.entityId.slice(0, 12)}` : ''}`,
        ]),
        stats: [
          { label: 'Recorded actions', value: String(entries.length), sub: 'in this window' },
        ],
      };
    },
  },
];
