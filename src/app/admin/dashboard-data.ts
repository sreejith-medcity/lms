import { db } from '@/lib/db';

/**
 * Everything the dashboard shows, computed in one place.
 *
 * Kept out of the page so each number has a name and a definition rather than
 * being an anonymous expression inside JSX. Edmingle's dashboard shows figures
 * nobody can trace; every number here can be pointed at its query.
 */

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(offsetMonths = 0) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offsetMonths, 1);
}

export function daysAgo(n: number) {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

export interface WeeklyBucket {
  start: Date;
  paise: number;
  count: number;
}

/** Twelve weekly buckets of captured payments, oldest first. */
export async function weeklyCollections(organizationId: string): Promise<WeeklyBucket[]> {
  const weeks = 12;
  const start = startOfDay();
  start.setDate(start.getDate() - (weeks * 7 - 1));

  const payments = await db.payment.findMany({
    where: {
      organizationId,
      status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
      createdAt: { gte: start },
    },
    select: { amountPaise: true, createdAt: true },
  });

  const buckets: WeeklyBucket[] = Array.from({ length: weeks }, (_, i) => {
    const s = new Date(start);
    s.setDate(s.getDate() + i * 7);
    return { start: s, paise: 0, count: 0 };
  });

  for (const p of payments) {
    const index = Math.floor((p.createdAt.getTime() - start.getTime()) / (7 * 864e5));
    const bucket = buckets[Math.min(Math.max(index, 0), weeks - 1)];
    bucket.paise += p.amountPaise;
    bucket.count += 1;
  }

  return buckets;
}

export interface AttendanceRate {
  expected: number;
  present: number;
  sessions: number;
  percent: number;
}

/**
 * Attendance measured honestly.
 *
 * Expected is every enrolled learner in the batch for every class it held, not
 * the number of people who happened to be marked. Counting only the rows that
 * exist would report near enough 100% forever, which is the trap Edmingle's
 * figure falls into.
 */
export async function attendanceRate(
  organizationId: string,
  since: Date,
): Promise<AttendanceRate> {
  const sessions = await db.liveSession.findMany({
    where: {
      organizationId,
      startsAt: { gte: since, lte: new Date() },
      status: { not: 'CANCELLED' },
    },
    select: { id: true, batchId: true },
  });

  if (sessions.length === 0) {
    return { expected: 0, present: 0, sessions: 0, percent: 0 };
  }

  const batchIds = [...new Set(sessions.map((s) => s.batchId))];

  const [rosters, present] = await Promise.all([
    db.enrollment.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batchIds }, status: { in: ['ENROLLED', 'COMPLETED'] } },
      _count: { _all: true },
    }),
    db.attendance.count({
      where: { sessionId: { in: sessions.map((s) => s.id) }, status: { in: ['PRESENT', 'LATE'] } },
    }),
  ]);

  const sizeOf = new Map(rosters.map((r) => [r.batchId, r._count._all]));
  const expected = sessions.reduce((n, s) => n + (sizeOf.get(s.batchId) ?? 0), 0);

  return {
    expected,
    present,
    sessions: sessions.length,
    percent: expected ? Math.round((present / expected) * 100) : 0,
  };
}

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: 'warn' | 'bad' | 'neutral';
}

/**
 * The queue. A dashboard that only reports numbers leaves the reader to work out
 * what to do; this says what is wrong and links to where it is fixed. Every item
 * is computed, so an empty list genuinely means there is nothing waiting.
 */
export async function attentionItems(organizationId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const now = new Date();

  const [unpriced, stalledOrders, silentClasses, emptyBatches, brokenMaterials] = await Promise.all([
    db.product.findMany({
      where: {
        organizationId,
        type: 'COURSE',
        status: 'PUBLISHED',
        deletedAt: null,
        pricingPlans: { none: { isActive: true } },
      },
      select: { id: true, title: true },
      take: 5,
    }),

    // Checkout started, never paid, and old enough that it is not still in progress.
    db.order.findMany({
      where: {
        organizationId,
        status: 'PENDING',
        placedAt: { lt: new Date(now.getTime() - 30 * 60_000) },
      },
      select: { id: true, totalPaise: true },
      take: 100,
    }),

    // A class nobody signed in to usually means a wrong join link, not empty seats.
    db.liveSession.findMany({
      where: {
        organizationId,
        startsAt: { gte: daysAgo(7), lt: now },
        status: { not: 'CANCELLED' },
        attendances: { none: {} },
      },
      select: { id: true, title: true },
      take: 5,
    }),

    db.batch.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        deletedAt: null,
        sessions: { none: { startsAt: { gte: now }, status: { not: 'CANCELLED' } } },
      },
      select: { id: true, name: true },
      take: 5,
    }),

    // A lesson with neither a file nor a link is a dead end for the learner.
    db.material.count({
      where: {
        section: { module: { organizationId } },
        assetId: null,
        externalUrl: null,
        bodyHtml: null,
        type: { notIn: ['LIVE_SESSION', 'ASSESSMENT'] },
      },
    }),
  ]);

  if (unpriced.length) {
    items.push({
      id: 'unpriced',
      tone: 'bad',
      title: `${unpriced.length} published course${unpriced.length === 1 ? '' : 's'} with no price`,
      detail: `${unpriced.map((p) => p.title).join(', ')}. These enrol for free right now.`,
      href: `/admin/courses/${unpriced[0].id}/pricing`,
    });
  }

  if (stalledOrders.length) {
    const value = stalledOrders.reduce((n, o) => n + o.totalPaise, 0);
    items.push({
      id: 'stalled',
      tone: 'warn',
      title: `${stalledOrders.length} checkout${stalledOrders.length === 1 ? '' : 's'} started but not paid`,
      detail: `Worth ${(value / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}. Worth a follow-up call.`,
      href: '/admin/learners',
    });
  }

  if (silentClasses.length) {
    items.push({
      id: 'silent',
      tone: 'warn',
      title: `${silentClasses.length} class${silentClasses.length === 1 ? '' : 'es'} with nobody signed in`,
      detail: 'Held in the last week with zero attendance. Usually a wrong join link rather than an empty room.',
      href: `/admin/sessions/${silentClasses[0].id}`,
    });
  }

  if (emptyBatches.length) {
    items.push({
      id: 'no-sessions',
      tone: 'warn',
      title: `${emptyBatches.length} active batch${emptyBatches.length === 1 ? '' : 'es'} with nothing scheduled`,
      detail: `${emptyBatches.map((b) => b.name).join(', ')} have no upcoming classes.`,
      href: '/admin/sessions',
    });
  }

  if (brokenMaterials > 0) {
    items.push({
      id: 'broken',
      tone: 'bad',
      title: `${brokenMaterials} lesson${brokenMaterials === 1 ? '' : 's'} with nothing attached`,
      detail: 'No file, no link, no text. A learner reaching one of these sees an empty page.',
      href: '/admin/courses',
    });
  }

  return items;
}
