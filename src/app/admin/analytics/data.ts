import { db } from '@/lib/db';

/**
 * Every figure the analytics pages show, defined once.
 *
 * The definitions matter more than the queries. "Revenue" means four different
 * things to four people, so nothing here is called revenue: money that arrived
 * is *collections*, money promised is *invoiced*, and the difference between
 * them is *outstanding*. Each page prints its own definitions at the bottom, so
 * a number in a meeting can always be traced back to what it counts.
 */

export const RANGES = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
] as const;

export function rangeFrom(param: string | undefined): { days: number; since: Date; label: string } {
  const days = RANGES.find((r) => String(r.days) === param)?.days ?? 30;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  return { days, since, label: RANGES.find((r) => r.days === days)!.label };
}

export interface Bucket {
  start: Date;
  value: number;
}

/** Splits a range into an even number of buckets: daily up to 30, then weekly. */
export function bucketsFor(since: Date, days: number): { starts: Date[]; stepDays: number } {
  const stepDays = days <= 31 ? 1 : days <= 120 ? 7 : 30;
  const count = Math.ceil(days / stepDays);
  const starts = Array.from({ length: count }, (_, i) => {
    const d = new Date(since);
    d.setDate(d.getDate() + i * stepDays);
    return d;
  });
  return { starts, stepDays };
}

export function bucketise(
  rows: { at: Date; value: number }[],
  since: Date,
  days: number,
): Bucket[] {
  const { starts, stepDays } = bucketsFor(since, days);
  const out = starts.map((start) => ({ start, value: 0 }));

  for (const row of rows) {
    const index = Math.floor((row.at.getTime() - since.getTime()) / (stepDays * 864e5));
    if (index < 0 || index >= out.length) continue;
    out[index].value += row.value;
  }
  return out;
}

/* Sales ------------------------------------------------------------------- */

export async function salesData(organizationId: string, since: Date, days: number) {
  const [payments, orders, refunds, byCourse] = await Promise.all([
    db.payment.findMany({
      where: {
        organizationId,
        status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
        createdAt: { gte: since },
      },
      select: { amountPaise: true, createdAt: true, method: true },
    }),
    db.order.findMany({
      where: { organizationId, placedAt: { gte: since } },
      select: { status: true, totalPaise: true, placedAt: true },
    }),
    db.refund.findMany({
      where: { payment: { organizationId }, createdAt: { gte: since } },
      select: { amountPaise: true },
    }),
    db.orderItem.groupBy({
      by: ['productId'],
      where: { order: { organizationId, status: 'PAID', placedAt: { gte: since } } },
      _sum: { totalPaise: true },
      _count: { _all: true },
    }),
  ]);

  const products = await db.product.findMany({
    where: { id: { in: byCourse.map((c) => c.productId) } },
    select: { id: true, title: true },
  });
  const titleOf = new Map(products.map((p) => [p.id, p.title]));

  const collected = payments.reduce((n, p) => n + p.amountPaise, 0);
  const invoiced = orders.filter((o) => o.status === 'PAID').reduce((n, o) => n + o.totalPaise, 0);
  const outstanding = orders
    .filter((o) => o.status === 'PENDING' || o.status === 'PARTIALLY_PAID')
    .reduce((n, o) => n + o.totalPaise, 0);
  const refunded = refunds.reduce((n, r) => n + r.amountPaise, 0);

  const started = orders.length;
  const paid = orders.filter((o) => o.status === 'PAID').length;

  const methods = new Map<string, number>();
  for (const p of payments) {
    const key = p.method ?? 'unknown';
    methods.set(key, (methods.get(key) ?? 0) + p.amountPaise);
  }

  return {
    collected,
    invoiced,
    outstanding,
    refunded,
    started,
    paid,
    conversion: started > 0 ? Math.round((paid / started) * 100) : 0,
    series: bucketise(
      payments.map((p) => ({ at: p.createdAt, value: p.amountPaise })),
      since,
      days,
    ),
    methods: [...methods.entries()].sort((a, b) => b[1] - a[1]),
    byCourse: byCourse
      .map((c) => ({
        title: titleOf.get(c.productId) ?? 'Unknown',
        paise: c._sum.totalPaise ?? 0,
        orders: c._count._all,
      }))
      .sort((a, b) => b.paise - a.paise)
      .slice(0, 8),
  };
}

/* Learning ---------------------------------------------------------------- */

export async function learningData(organizationId: string, since: Date, days: number) {
  const [enrolments, completions, active, attempts, byCourse] = await Promise.all([
    db.enrollment.findMany({
      where: { organizationId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    db.enrollment.count({
      where: { organizationId, completedAt: { gte: since } },
    }),
    db.enrollment.count({
      where: { organizationId, lastActivityAt: { gte: since } },
    }),
    db.attempt.findMany({
      where: {
        assessment: { organizationId },
        submittedAt: { gte: since },
        scorePercent: { not: null },
      },
      select: { scorePercent: true, passed: true },
    }),
    db.enrollment.groupBy({
      by: ['productId'],
      where: { organizationId, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
      _count: { _all: true },
      _avg: { progressPercent: true },
    }),
  ]);

  const products = await db.product.findMany({
    where: { id: { in: byCourse.map((c) => c.productId) } },
    select: { id: true, title: true },
  });
  const titleOf = new Map(products.map((p) => [p.id, p.title]));

  const scored = attempts.filter((a) => a.scorePercent != null);
  const averageScore =
    scored.length > 0
      ? Math.round(scored.reduce((n, a) => n + (a.scorePercent ?? 0), 0) / scored.length)
      : null;

  return {
    enrolments: enrolments.length,
    completions,
    active,
    averageScore,
    passRate:
      scored.length > 0
        ? Math.round((scored.filter((a) => a.passed).length / scored.length) * 100)
        : null,
    attemptsCount: scored.length,
    series: bucketise(
      enrolments.map((e) => ({ at: e.createdAt, value: 1 })),
      since,
      days,
    ),
    byCourse: byCourse
      .map((c) => ({
        title: titleOf.get(c.productId) ?? 'Unknown',
        learners: c._count._all,
        progress: Math.round(c._avg.progressPercent ?? 0),
      }))
      .sort((a, b) => b.learners - a.learners)
      .slice(0, 8),
  };
}

/* Attendance -------------------------------------------------------------- */

export async function attendanceData(organizationId: string, since: Date, days: number) {
  const sessions = await db.liveSession.findMany({
    where: {
      organizationId,
      startsAt: { gte: since, lte: new Date() },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      batchId: true,
      startsAt: true,
      batch: { select: { name: true } },
    },
  });

  const cancelled = await db.liveSession.count({
    where: { organizationId, startsAt: { gte: since, lte: new Date() }, status: 'CANCELLED' },
  });

  if (sessions.length === 0) {
    return {
      sessions: 0,
      cancelled,
      expected: 0,
      present: 0,
      late: 0,
      percent: 0,
      inTimePercent: 0,
      series: [] as Bucket[],
      byBatch: [] as { name: string; percent: number; sessions: number }[],
    };
  }

  const batchIds = [...new Set(sessions.map((s) => s.batchId))];

  const [rosters, attendances] = await Promise.all([
    db.enrollment.groupBy({
      by: ['batchId'],
      where: { organizationId, batchId: { in: batchIds }, status: { in: ['ENROLLED', 'COMPLETED'] } },
      _count: { _all: true },
    }),
    db.attendance.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { sessionId: true, status: true },
    }),
  ]);

  const sizeOf = new Map(rosters.map((r) => [r.batchId, r._count._all]));
  const expected = sessions.reduce((n, s) => n + (sizeOf.get(s.batchId) ?? 0), 0);

  const present = attendances.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
  const late = attendances.filter((a) => a.status === 'LATE').length;

  const bySession = new Map<string, number>();
  for (const a of attendances) {
    if (a.status === 'PRESENT' || a.status === 'LATE') {
      bySession.set(a.sessionId, (bySession.get(a.sessionId) ?? 0) + 1);
    }
  }

  const byBatchMap = new Map<string, { name: string; expected: number; present: number; sessions: number }>();
  for (const s of sessions) {
    const entry = byBatchMap.get(s.batchId) ?? {
      name: s.batch.name,
      expected: 0,
      present: 0,
      sessions: 0,
    };
    entry.expected += sizeOf.get(s.batchId) ?? 0;
    entry.present += bySession.get(s.id) ?? 0;
    entry.sessions += 1;
    byBatchMap.set(s.batchId, entry);
  }

  return {
    sessions: sessions.length,
    cancelled,
    expected,
    present,
    late,
    percent: expected > 0 ? Math.round((present / expected) * 100) : 0,
    inTimePercent: present > 0 ? Math.round(((present - late) / present) * 100) : 0,
    series: bucketise(
      sessions.map((s) => ({ at: s.startsAt, value: bySession.get(s.id) ?? 0 })),
      since,
      days,
    ),
    byBatch: [...byBatchMap.values()]
      .map((b) => ({
        name: b.name,
        percent: b.expected > 0 ? Math.round((b.present / b.expected) * 100) : 0,
        sessions: b.sessions,
      }))
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 8),
  };
}
