import { db } from '@/lib/db';
import { formatBytes } from '@/lib/storage';
import { dayKey, formatTime } from '@/lib/clock';
import type { ReportDef } from './types';

/**
 * Trainers, messages, assessments and the plumbing.
 *
 * The operational half. Most of these exist because somebody asks the question
 * once a month and currently answers it by counting rows by hand.
 */

export const trainerReports: ReportDef[] = [
  {
    id: 'trainer-load',
    title: 'Who is teaching what',
    category: 'trainer',
    question: 'How much is each trainer actually carrying?',
    definitions: [
      ['Classes held', 'Sessions in their batches that started in the window and were not cancelled.'],
      ['Hours', 'Scheduled length of those classes, not time anybody clocked.'],
      ['Turnout', 'Sign-ins across those classes over the roll, so a trainer with two big batches is comparable to one with four small ones.'],
    ],
    async run(ctx) {
      const staff = await db.batchStaff.findMany({
        where: { batch: { organizationId: ctx.organizationId, deletedAt: null } },
        select: { userId: true, role: true, batchId: true },
      });
      if (staff.length === 0) return { columns: [{ key: 'x', label: '' }], rows: [] };

      const [people, sessions] = await Promise.all([
        db.user.findMany({
          where: { id: { in: [...new Set(staff.map((s) => s.userId))] } },
          select: { id: true, name: true },
        }),
        db.liveSession.findMany({
          where: {
            organizationId: ctx.organizationId,
            startsAt: { gte: ctx.since, lte: new Date() },
            status: { not: 'CANCELLED' },
          },
          select: {
            batchId: true,
            startsAt: true,
            endsAt: true,
            attendances: { select: { status: true } },
            batch: { select: { _count: { select: { enrollments: true } } } },
          },
        }),
      ]);

      const names = new Map(people.map((p) => [p.id, p.name]));
      const batchesOf = new Map<string, Set<string>>();
      for (const s of staff) {
        const set = batchesOf.get(s.userId) ?? new Set<string>();
        set.add(s.batchId);
        batchesOf.set(s.userId, set);
      }

      const rows = [...batchesOf.entries()]
        .map(([userId, batchIds]) => {
          const theirs = sessions.filter((s) => s.batchId != null && batchIds.has(s.batchId));
          const minutes = theirs.reduce(
            (n, s) => n + Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000),
            0,
          );
          const came = theirs.reduce(
            (n, s) =>
              n + s.attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length,
            0,
          );
          const expected = theirs.reduce((n, s) => n + (s.batch?._count.enrollments ?? 1), 0);

          return {
            held: theirs.length,
            row: [
              names.get(userId) ?? 'Unknown',
              batchIds.size,
              theirs.length,
              (minutes / 60).toFixed(1),
              expected > 0 ? `${Math.round((came / expected) * 100)}%` : '—',
            ],
          };
        })
        .sort((a, b) => b.held - a.held);

      return {
        columns: [
          { key: 'trainer', label: 'Trainer' },
          { key: 'batches', label: 'Batches', numeric: true },
          { key: 'held', label: 'Classes held', numeric: true },
          { key: 'hours', label: 'Hours', numeric: true },
          { key: 'turnout', label: 'Turnout', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Counted from batch staffing, since that is where trainers are actually assigned.',
      };
    },
  },
];

export const messagingReports: ReportDef[] = [
  {
    id: 'notification-log',
    title: 'The outbox',
    category: 'messaging',
    question: 'What have we told people, and did it go?',
    definitions: [
      ['Queued', 'Written and waiting. Nothing sends until a messaging provider is connected in Phase 7.'],
      ['Target', 'The address it would go to, decided when it was queued.'],
    ],
    async run(ctx) {
      const logs = await db.notificationLog.findMany({
        where: { organizationId: ctx.organizationId, createdAt: { gte: ctx.since } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          createdAt: true,
          channel: true,
          eventKey: true,
          target: true,
          status: true,
          error: true,
          user: { select: { name: true } },
        },
      });

      return {
        columns: [
          { key: 'when', label: 'When' },
          { key: 'who', label: 'To' },
          { key: 'channel', label: 'Channel' },
          { key: 'event', label: 'About' },
          { key: 'target', label: 'Address' },
          { key: 'status', label: 'State' },
        ],
        rows: logs.map((l) => [
          dayKey(l.createdAt, ctx.timeZone),
          l.user?.name ?? '—',
          l.channel.toLowerCase(),
          l.eventKey,
          l.target,
          l.error ? `${l.status.toLowerCase()}: ${l.error}` : l.status.toLowerCase(),
        ]),
        stats: [
          { label: 'In the outbox', value: String(logs.filter((l) => l.status === 'QUEUED').length) },
          { label: 'Written', value: String(logs.length), sub: 'in this window' },
        ],
      };
    },
  },

  {
    id: 'notifications-by-event',
    title: 'Notifications by kind',
    category: 'messaging',
    question: 'What are we mostly telling people about?',
    definitions: [
      ['Event', 'The thing that caused the message: a class reminder, an absence, a cart nudge.'],
      ['People', 'Distinct recipients, so one person told five times counts once.'],
    ],
    async run(ctx) {
      const logs = await db.notificationLog.findMany({
        where: { organizationId: ctx.organizationId, createdAt: { gte: ctx.since } },
        select: { eventKey: true, channel: true, status: true, userId: true },
      });

      const byEvent = new Map<string, { count: number; people: Set<string>; sent: number }>();
      for (const l of logs) {
        const entry = byEvent.get(l.eventKey) ?? { count: 0, people: new Set<string>(), sent: 0 };
        entry.count += 1;
        if (l.userId) entry.people.add(l.userId);
        if (l.status !== 'QUEUED' && l.status !== 'FAILED') entry.sent += 1;
        byEvent.set(l.eventKey, entry);
      }

      return {
        columns: [
          { key: 'event', label: 'Event' },
          { key: 'messages', label: 'Messages', numeric: true },
          { key: 'people', label: 'People', numeric: true },
          { key: 'sent', label: 'Actually sent', numeric: true },
        ],
        rows: [...byEvent.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([event, v]) => [event, v.count, v.people.size, v.sent]),
      };
    },
  },
];

export const assessmentReports: ReportDef[] = [
  {
    id: 'assessment-results',
    title: 'Assessment results',
    category: 'advanced',
    question: 'Which tests are people passing, and which are we failing them on?',
    definitions: [
      ['Attempts', 'Marked attempts. One in progress or awaiting marking is not counted.'],
      ['Pass rate', 'Attempts that passed over attempts marked. Not learners: somebody who failed twice and passed counts three times.'],
    ],
    async run(ctx) {
      const assessments = await db.assessment.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          title: true,
          kind: true,
          passPercent: true,
          attempts: {
            where: { status: 'EVALUATED', submittedAt: { gte: ctx.since } },
            select: { scorePercent: true, passed: true, userId: true },
          },
        },
      });

      const rows = assessments
        .filter((a) => a.attempts.length > 0)
        .map((a) => {
          const scores = a.attempts
            .map((t) => t.scorePercent)
            .filter((s): s is number => s != null);
          const passed = a.attempts.filter((t) => t.passed).length;
          const rate = Math.round((passed / a.attempts.length) * 100);
          return {
            rate,
            row: [
              a.title,
              a.kind.toLowerCase(),
              `${a.passPercent}%`,
              a.attempts.length,
              new Set(a.attempts.map((t) => t.userId)).size,
              scores.length
                ? `${Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)}%`
                : '—',
              `${rate}%`,
            ],
          };
        })
        .sort((a, b) => a.rate - b.rate);

      return {
        columns: [
          { key: 'assessment', label: 'Assessment' },
          { key: 'kind', label: 'Kind' },
          { key: 'pass', label: 'Pass mark', numeric: true },
          { key: 'attempts', label: 'Attempts', numeric: true },
          { key: 'people', label: 'People', numeric: true },
          { key: 'average', label: 'Average score', numeric: true },
          { key: 'rate', label: 'Pass rate', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Hardest first. A pass rate near zero is usually the paper rather than the cohort.',
      };
    },
  },

  {
    id: 'question-difficulty',
    title: 'Question difficulty',
    category: 'advanced',
    question: 'Which questions is nearly everybody getting wrong?',
    definitions: [
      ['Answered', 'Times this question was answered in a marked attempt.'],
      ['Correct', 'Answers awarded full marks.'],
      ['Difficulty', 'The share answered wrongly. Above 80% usually means the question is unclear, not that the topic is hard.'],
    ],
    async run(ctx) {
      const answers = await db.answer.findMany({
        where: {
          attempt: {
            status: 'EVALUATED',
            submittedAt: { gte: ctx.since },
            assessment: { organizationId: ctx.organizationId },
          },
        },
        select: {
          isCorrect: true,
          question: { select: { id: true, promptHtml: true, type: true, difficulty: true } },
        },
      });

      const byQuestion = new Map<
        string,
        { prompt: string; type: string; n: number; right: number }
      >();
      for (const a of answers) {
        if (!a.question) continue;
        const entry = byQuestion.get(a.question.id) ?? {
          prompt: a.question.promptHtml,
          type: a.question.type,
          n: 0,
          right: 0,
        };
        entry.n += 1;
        if (a.isCorrect) entry.right += 1;
        byQuestion.set(a.question.id, entry);
      }

      const rows = [...byQuestion.values()]
        .filter((q) => q.n >= 3)
        .map((q) => {
          const difficulty = Math.round(((q.n - q.right) / q.n) * 100);
          return {
            difficulty,
            row: [
              q.prompt.replace(/<[^>]+>/g, '').slice(0, 120),
              q.type.toLowerCase(),
              q.n,
              q.right,
              `${difficulty}%`,
            ],
          };
        })
        .sort((a, b) => b.difficulty - a.difficulty)
        .slice(0, 100);

      return {
        columns: [
          { key: 'question', label: 'Question' },
          { key: 'type', label: 'Type' },
          { key: 'answered', label: 'Answered', numeric: true },
          { key: 'correct', label: 'Correct', numeric: true },
          { key: 'difficulty', label: 'Got it wrong', numeric: true },
        ],
        rows: rows.map((r) => r.row),
        note: 'Only questions answered at least three times.',
      };
    },
  },
];

export const operationsReports: ReportDef[] = [
  {
    id: 'branch-statistics',
    title: 'Branch statistics',
    category: 'operations',
    question: 'How is each branch doing on its own terms?',
    definitions: [
      ['Learners', 'People with an enrolment in a batch belonging to that branch.'],
      ['Classes held', 'Sessions in those batches that started in the window and were not cancelled.'],
    ],
    async run(ctx) {
      const branches = await db.branch.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          name: true,
          isActive: true,
          batches: {
            where: { deletedAt: null },
            select: {
              id: true,
              _count: { select: { enrollments: true } },
            },
          },
        },
      });

      const sessions = await db.liveSession.groupBy({
        by: ['batchId'],
        where: {
          organizationId: ctx.organizationId,
          startsAt: { gte: ctx.since, lte: new Date() },
          status: { not: 'CANCELLED' },
        },
        _count: true,
      });
      const heldBy = new Map(sessions.map((s) => [s.batchId, s._count]));

      return {
        columns: [
          { key: 'branch', label: 'Branch' },
          { key: 'state', label: 'State' },
          { key: 'batches', label: 'Batches', numeric: true },
          { key: 'learners', label: 'Learners', numeric: true },
          { key: 'held', label: 'Classes held', numeric: true },
        ],
        rows: branches.map((b) => [
          b.name,
          b.isActive ? 'open' : 'closed',
          b.batches.length,
          b.batches.reduce((n, x) => n + x._count.enrollments, 0),
          b.batches.reduce((n, x) => n + (heldBy.get(x.id) ?? 0), 0),
        ]),
      };
    },
  },

  {
    id: 'storage-by-type',
    title: 'Storage',
    category: 'operations',
    question: 'What is filling the bucket?',
    definitions: [
      ['Size', 'Bytes as recorded when each file finished uploading.'],
      ['Unused', 'Files no material or recording points at. Safe to review, not automatically safe to delete.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const assets = await db.asset.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: { type: true, sizeBytes: true, usageCount: true },
      });

      const byType = new Map<string, { count: number; bytes: number; unused: number }>();
      for (const a of assets) {
        const entry = byType.get(a.type) ?? { count: 0, bytes: 0, unused: 0 };
        entry.count += 1;
        entry.bytes += Number(a.sizeBytes ?? 0);
        if (a.usageCount === 0) entry.unused += 1;
        byType.set(a.type, entry);
      }

      const total = assets.reduce((n, a) => n + Number(a.sizeBytes ?? 0), 0);

      return {
        columns: [
          { key: 'type', label: 'Kind' },
          { key: 'files', label: 'Files', numeric: true },
          { key: 'size', label: 'Size', numeric: true },
          { key: 'share', label: 'Share', numeric: true },
          { key: 'unused', label: 'Unused', numeric: true },
        ],
        rows: [...byType.entries()]
          .sort((a, b) => b[1].bytes - a[1].bytes)
          .map(([type, v]) => [
            type.toLowerCase(),
            v.count,
            formatBytes(v.bytes),
            total > 0 ? `${Math.round((v.bytes / total) * 100)}%` : '—',
            v.unused,
          ]),
        stats: [
          { label: 'Stored', value: formatBytes(total), sub: `${assets.length} files` },
          {
            label: 'Unused',
            value: String(assets.filter((a) => a.usageCount === 0).length),
            sub: 'nothing points at these',
          },
        ],
      };
    },
  },

  {
    id: 'metered-usage',
    title: 'Metered usage',
    category: 'operations',
    question: 'What is this academy consuming, day by day?',
    definitions: [
      ['Bandwidth', 'Estimated per full file fetch. Range requests, which are the player seeking inside a file it already started, are not counted.'],
      ['Quantity', 'The unit depends on the metric: bytes for storage and bandwidth, minutes for sessions, counts for the rest.'],
    ],
    async run(ctx) {
      const records = await db.usageRecord.findMany({
        where: { tenantId: ctx.tenantId, day: { gte: ctx.since } },
        orderBy: { day: 'desc' },
        take: 500,
        select: { day: true, metric: true, quantity: true, costPaise: true },
      });

      return {
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'metric', label: 'Metric' },
          { key: 'quantity', label: 'Quantity', numeric: true },
        ],
        rows: records.map((r) => {
          const n = Number(r.quantity);
          const isBytes = r.metric === 'STORAGE_BYTES' || r.metric === 'BANDWIDTH_BYTES';
          return [
            dayKey(r.day, ctx.timeZone),
            r.metric.toLowerCase().replace(/_/g, ' '),
            isBytes ? formatBytes(n) : n,
          ];
        }),
        note: 'Written by the same code that does the work, so it cannot drift from what actually happened.',
      };
    },
  },

  {
    id: 'upcoming-load',
    title: 'The week ahead',
    category: 'operations',
    question: 'What is scheduled, and is anybody double-booked?',
    definitions: [
      ['Scheduled', 'Classes starting in the next seven days that are not cancelled.'],
      ['Clash', 'Another class in the same batch overlapping this one. A trainer teaching two batches at once shows up as two rows at the same time.'],
    ],
    ignoresRange: true,
    async run(ctx) {
      const sessions = await db.liveSession.findMany({
        where: {
          organizationId: ctx.organizationId,
          startsAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 86_400_000) },
          status: { not: 'CANCELLED' },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          title: true,
          startsAt: true,
          endsAt: true,
          joinUrl: true,
          batch: {
            select: {
              name: true,
              _count: { select: { enrollments: true } },
              branch: { select: { name: true } },
            },
          },
        },
      });

      return {
        columns: [
          { key: 'day', label: 'Day' },
          { key: 'time', label: 'Time' },
          { key: 'class', label: 'Class' },
          { key: 'batch', label: 'Batch' },
          { key: 'branch', label: 'Branch' },
          { key: 'roll', label: 'On the roll', numeric: true },
          { key: 'link', label: 'Join link' },
        ],
        rows: sessions.map((s) => [
          dayKey(s.startsAt, ctx.timeZone),
          formatTime(s.startsAt, ctx.timeZone),
          s.title,
          s.batch?.name ?? 'One to one',
          s.batch?.branch.name ?? '—',
          s.batch?._count.enrollments ?? 1,
          s.joinUrl ? 'set' : 'missing',
        ]),
        note: 'A missing join link on a class starting tomorrow is the most common avoidable failure here.',
      };
    },
  },
];
