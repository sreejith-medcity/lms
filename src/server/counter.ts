'use server';

import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { canSeeLearner, sessionWhere, staffScope } from '@/lib/scope';
import { readMemberCode } from '@/lib/member-card';
import { recordAttendance } from '@/lib/attendance';
import { recordAudit } from '@/lib/audit';
import { dayKey } from '@/lib/clock';
import { passesFor, type PassSummary } from '@/lib/passes';
import type { ActionState } from '@/server/courses';

/**
 * The counter: a learner presents their card, the desk sees who they are
 * and what is due, and checks them in to today's class in one press.
 *
 * Reading a card needs the learner permission; checking somebody in needs
 * the register permission, the same as a teacher keeping one. Money is
 * shown only to somebody who may see fees, so a card scanned by a
 * teacher gives the classes and nothing about what was paid.
 */

export interface CounterCard {
  userId: string;
  name: string;
  registrationNo: number | null;
  status: string;
  avatarUrl: string | null;
  phoneMasked: string | null;
  since: string;
  batches: { id: string; name: string; course: string; status: string }[];
  /** Null when the person asking may not see fees. */
  duePaise: number | null;
  overdueCount: number;
  today: { sessionId: string; title: string; batch: string | null; startsAt: string; endsAt: string; mark: string | null }[];
  passes: { plan: string; left: number; total: number; expiresAt: string | null; batch: string | null }[];
}

export interface LookupState extends ActionState {
  card?: CounterCard;
}

function mask(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `${phone.slice(0, phone.length - 4).replace(/\d/g, '•')}${digits.slice(-4)}` : '••••';
}

export async function lookupMember(raw: string): Promise<LookupState> {
  try {
    const [tenant, me] = await Promise.all([requireTenant(), requireStaff('learner.learner_management', 'view')]);
    if (me.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
    const read = readMemberCode(raw);
    if (!read) return { error: 'That is not a member card. Scan the QR on the card, or type the registration number.' };

    const scope = await staffScope(me);
    const where = read.kind === 'user' ? { id: read.userId } : { registrationNo: read.registrationNo };
    const learner = await db.user.findFirst({
      where: { ...where, organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      select: {
        id: true,
        name: true,
        registrationNo: true,
        status: true,
        avatarUrl: true,
        phone: true,
        createdAt: true,
        enrollments: {
          where: { status: { in: ['ENROLLED', 'REGISTERED', 'ON_LEAVE'] } },
          select: { id: true, batch: { select: { id: true, name: true, status: true, course: { select: { product: { select: { title: true } } } } } } },
        },
      },
    });
    if (!learner) return { error: read.kind === 'user' ? 'This card belongs to nobody here any more.' : `No learner has registration number ${read.registrationNo}.` };
    if (!(await canSeeLearner(scope, tenant.organizationId, learner.id))) return { error: 'That learner is outside your branch.' };

    const canSeeFees = Boolean(me.permissions['sales.fee_tracking']?.view || me.permissions['sales.payments']?.view);
    const now = new Date();
    const today = dayKey(now, tenant.timezone);
    const from = new Date(now.getTime() - 14 * 60 * 60_000);
    const to = new Date(now.getTime() + 14 * 60 * 60_000);
    const batchIds = learner.enrollments.map((e) => e.batch?.id).filter((x): x is string => Boolean(x));

    const [dues, sessions, passes] = await Promise.all([
      canSeeFees
        ? db.instalment.findMany({
            where: { enrollment: { organizationId: tenant.organizationId, userId: learner.id }, paidAt: null },
            select: { amountPaise: true, paidPaise: true, dueDate: true },
          })
        : Promise.resolve(null),
      db.liveSession.findMany({
        where: {
          organizationId: tenant.organizationId,
          status: { in: ['SCHEDULED', 'LIVE', 'COMPLETED'] },
          isHoliday: false,
          startsAt: { gte: from, lte: to },
          AND: [{ OR: [{ batchId: { in: batchIds } }, { learnerId: learner.id }] }, sessionWhere(scope)],
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, title: true, startsAt: true, endsAt: true, batch: { select: { name: true } }, attendances: { where: { userId: learner.id }, select: { status: true } } },
      }),
      passesFor(tenant.organizationId, learner.id),
    ]);

    const card: CounterCard = {
      userId: learner.id,
      name: learner.name,
      registrationNo: learner.registrationNo,
      status: learner.status,
      avatarUrl: learner.avatarUrl,
      phoneMasked: mask(learner.phone),
      since: learner.createdAt.toISOString(),
      batches: learner.enrollments
        .filter((e) => e.batch)
        .map((e) => ({ id: e.batch!.id, name: e.batch!.name, course: e.batch!.course.product.title, status: e.batch!.status })),
      duePaise: dues ? dues.reduce((n, i) => n + Math.max(0, i.amountPaise - i.paidPaise), 0) : null,
      overdueCount: dues ? dues.filter((i) => i.dueDate < now && i.amountPaise > i.paidPaise).length : 0,
      today: sessions
        .filter((s) => dayKey(s.startsAt, tenant.timezone) === today)
        .map((s) => ({ sessionId: s.id, title: s.title, batch: s.batch?.name ?? null, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), mark: s.attendances[0]?.status ?? null })),
      passes: passes.filter((p: PassSummary) => p.status === 'ACTIVE').map((p) => ({ plan: p.plan, left: p.left, total: p.classesTotal, expiresAt: p.expiresAt?.toISOString() ?? null, batch: p.batch })),
    };
    return { ok: true, card };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
    if (message === 'FORBIDDEN') return { error: 'You do not have permission to read cards.' };
    console.error('[counter]', message);
    return { error: 'Something went wrong. Please try again.' };
  }
}

/** Present, from the counter: the same mark a teacher's register would make, with a note saying where it came from. */
export async function counterCheckIn(sessionId: string, userId: string): Promise<ActionState> {
  try {
    const [tenant, me] = await Promise.all([requireTenant(), requireStaff('scheduling.sessions', 'edit')]);
    if (me.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
    const scope = await staffScope(me);
    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId: tenant.organizationId, ...sessionWhere(scope) },
      select: { id: true, status: true, isHoliday: true, startsAt: true, endsAt: true, learnerId: true, batch: { select: { enrollments: { where: { userId, status: { in: ['ENROLLED', 'REGISTERED', 'ON_LEAVE'] } }, select: { id: true } } } } },
    });
    if (!session) return { error: 'Class not found.' };
    if (session.status === 'CANCELLED' || session.isHoliday) return { error: 'That class was called off.' };
    const onRoll = session.learnerId === userId || (session.batch?.enrollments.length ?? 0) > 0;
    if (!onRoll) return { error: 'This learner is not on that class.' };
    const now = new Date();
    if (session.startsAt.getTime() - now.getTime() > 2 * 60 * 60_000) return { error: 'That class is more than two hours away; check them in nearer the time.' };
    const inTime = now.getTime() <= session.startsAt.getTime() + 10 * 60_000;
    await recordAttendance({ organizationId: tenant.organizationId, sessionId: session.id, userId, status: inTime ? 'PRESENT' : 'LATE', source: 'REGISTER', actorId: me.id, note: 'Checked in at the counter', joinedAt: now, wasInTime: inTime });
    await recordAudit({ organizationId: tenant.organizationId, actorId: me.id, action: 'counter.checked_in', entity: 'LiveSession', entityId: session.id, after: { userId, inTime } });
    return { ok: true, message: inTime ? 'Checked in.' : 'Checked in, marked late.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
    if (message === 'FORBIDDEN') return { error: 'You do not have permission to check people in.' };
    console.error('[counter]', message);
    return { error: 'Something went wrong. Please try again.' };
  }
}
