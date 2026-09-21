import { db } from '@/lib/db';

/**
 * Prepaid passes: the rules, shared by the counter that sells them, the
 * register that draws them down and the night job that lets them lapse.
 *
 * A pass buys a place on a batch (an enrolment) and a number of classes.
 * Being marked present or late in a class of that batch uses one; absent
 * uses none, because a class not attended was not taken. When the last
 * one is used, or the validity runs out, the pass closes and the place
 * on the batch expires with it: access ends, the history stays.
 */

export type PassSummary = {
  id: string;
  plan: string;
  classesTotal: number;
  classesUsed: number;
  left: number;
  expiresAt: Date | null;
  status: 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'CANCELLED';
  batch: string | null;
};

/** What a learner holds, live passes first. */
export async function passesFor(organizationId: string, userId: string): Promise<PassSummary[]> {
  const rows = await db.prepaidPass.findMany({
    where: { organizationId, userId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, classesTotal: true, classesUsed: true, expiresAt: true, status: true, enrollmentId: true, plan: { select: { name: true } } },
    take: 20,
  });
  const enrolmentIds = rows.map((r) => r.enrollmentId).filter((x): x is string => Boolean(x));
  const batches = enrolmentIds.length
    ? new Map((await db.enrollment.findMany({ where: { organizationId, id: { in: enrolmentIds } }, select: { id: true, batch: { select: { name: true } } } })).map((e) => [e.id, e.batch?.name ?? null]))
    : new Map<string, string | null>();
  return rows.map((r) => ({
    id: r.id,
    plan: r.plan.name,
    classesTotal: r.classesTotal,
    classesUsed: r.classesUsed,
    left: Math.max(0, r.classesTotal - r.classesUsed),
    expiresAt: r.expiresAt,
    status: r.status,
    batch: r.enrollmentId ? (batches.get(r.enrollmentId) ?? null) : null,
  }));
}

/**
 * One class off the pass that bought this learner's place on the class's
 * batch, once per session however many times the register is saved.
 * Returns what changed, for the caller's log; never throws into a
 * register, because a pass problem must not lose an attendance mark.
 */
export async function drawDownPass(organizationId: string, userId: string, sessionId: string): Promise<{ used: boolean; closed: boolean }> {
  try {
    const session = await db.liveSession.findFirst({ where: { id: sessionId, organizationId }, select: { batchId: true, startsAt: true } });
    if (!session?.batchId) return { used: false, closed: false };
    const enrolment = await db.enrollment.findFirst({ where: { organizationId, userId, batchId: session.batchId }, select: { id: true } });
    if (!enrolment) return { used: false, closed: false };
    const pass = await db.prepaidPass.findFirst({
      where: { organizationId, userId, enrollmentId: enrolment.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, classesTotal: true, classesUsed: true, expiresAt: true },
    });
    if (!pass) return { used: false, closed: false };

    // A pass that lapsed before the class is closed here rather than by the
    // night job, so the register is the first to know.
    if (pass.expiresAt && pass.expiresAt < session.startsAt) {
      await closePass(organizationId, pass.id, 'EXPIRED');
      return { used: false, closed: true };
    }
    const created = await db.passUse.createMany({ data: [{ passId: pass.id, sessionId }], skipDuplicates: true });
    if (created.count === 0) return { used: false, closed: false };
    const updated = await db.prepaidPass.update({ where: { id: pass.id }, data: { classesUsed: { increment: 1 } }, select: { classesUsed: true, classesTotal: true } });
    if (updated.classesUsed >= updated.classesTotal) {
      await closePass(organizationId, pass.id, 'USED_UP');
      return { used: true, closed: true };
    }
    return { used: true, closed: false };
  } catch (err) {
    console.error('[passes] draw-down failed', err instanceof Error ? err.message : err);
    return { used: false, closed: false };
  }
}

/** Close a pass and end the place on the batch it bought. */
export async function closePass(organizationId: string, passId: string, status: 'USED_UP' | 'EXPIRED' | 'CANCELLED'): Promise<void> {
  const pass = await db.prepaidPass.findFirst({ where: { id: passId, organizationId }, select: { enrollmentId: true, status: true } });
  if (!pass || pass.status !== 'ACTIVE') return;
  await db.prepaidPass.update({ where: { id: passId }, data: { status } });
  if (!pass.enrollmentId) return;
  // The place ends only when this pass was what bought it: not when the
  // learner paid the course fee outright and the pass was a top-up, and
  // not while another live pass still covers the same place.
  const [enrolment, others] = await Promise.all([
    db.enrollment.findFirst({ where: { organizationId, id: pass.enrollmentId }, select: { orderItemId: true, pricingPlanId: true } }),
    db.prepaidPass.count({ where: { organizationId, enrollmentId: pass.enrollmentId, status: 'ACTIVE', id: { not: passId } } }),
  ]);
  if (!enrolment || enrolment.orderItemId || enrolment.pricingPlanId || others > 0) return;
  await db.enrollment.updateMany({ where: { organizationId, id: pass.enrollmentId, status: { in: ['ENROLLED', 'REGISTERED'] } }, data: { status: 'EXPIRED', expiresAt: new Date() } });
}

/** The night job: every pass past its validity closes. */
export async function lapsePasses(organizationId: string, now = new Date()): Promise<number> {
  const due = await db.prepaidPass.findMany({ where: { organizationId, status: 'ACTIVE', expiresAt: { lt: now } }, select: { id: true } });
  for (const p of due) await closePass(organizationId, p.id, 'EXPIRED');
  return due.length;
}
