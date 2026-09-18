'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canSeeBatch, staffScope } from '@/lib/scope';
import { recordAttendance } from '@/lib/attendance';
import { canCorrect, isMark, type Mark } from '@/lib/attendance-rules';
import { settingNumber } from '@/lib/settings/store';
import type { ActionState } from '@/server/courses';

/**
 * The register a teacher keeps on a phone, and the corrections after it.
 *
 * Submitting writes only the learners the teacher marked. Anybody left
 * unmarked stays unrecorded, which the register shows as such; nothing
 * turns silence into an absence. The parents of anybody marked absent or
 * late are told the moment the save has gone through, once per learner,
 * class and status.
 */

async function guard(action: 'view' | 'edit' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('scheduling.sessions', action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[register]', message);
  return { error: 'Something went wrong. Nothing was saved; please try again.' };
}

async function sessionInScope(organizationId: string, sessionId: string, user: Awaited<ReturnType<typeof requireStaff>>) {
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      isHoliday: true,
      startsAt: true,
      endsAt: true,
      batchId: true,
      learnerId: true,
      registerSubmittedAt: true,
      batch: { select: { id: true, branchId: true, enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } }, select: { userId: true } } } },
    },
  });
  if (!session) return null;
  const scope = await staffScope(user);
  if (session.batch && !canSeeBatch(scope, session.batch)) return null;
  if (!session.batch && scope.kind === 'batches') return null;
  return { session, scope };
}

export interface RegisterResult extends ActionState {
  recorded?: number;
  unchanged?: number;
  alerted?: number;
  savedAt?: string;
}

export async function submitRegister(sessionId: string, marks: { userId: string; status: string }[]): Promise<RegisterResult> {
  try {
    const { tenant, user } = await guard();
    const found = await sessionInScope(tenant.organizationId, sessionId, user);
    if (!found) return { error: 'Class not found.' };
    const { session } = found;
    if (session.status === 'CANCELLED' || session.isHoliday) return { error: 'That class was called off, so there is no register to keep.' };
    if (session.startsAt > new Date()) return { error: 'That class has not started yet.' };

    const roll = new Set(session.batch ? session.batch.enrollments.map((e) => e.userId) : session.learnerId ? [session.learnerId] : []);
    const clean: { userId: string; status: Mark }[] = [];
    for (const m of marks) {
      if (!roll.has(m.userId)) continue;
      if (!isMark(m.status)) return { error: 'One of the marks is not Present, Absent, Late or Excused.' };
      clean.push({ userId: m.userId, status: m.status });
    }
    if (clean.length === 0) return { error: 'Nobody is marked. Mark at least one learner, then submit.' };

    // Once a register has been confirmed, a different mark is a correction
    // and needs a reason; the register itself only records what is new.
    const existing = new Map(
      (await db.attendance.findMany({ where: { sessionId: session.id, userId: { in: clean.map((c) => c.userId) }, session: { organizationId: tenant.organizationId } }, select: { userId: true, status: true } })).map((a) => [a.userId, a.status as Mark]),
    );
    if (session.registerSubmittedAt && clean.some((c) => existing.has(c.userId) && existing.get(c.userId) !== c.status)) {
      return { error: 'This register was already confirmed. Change a mark from the class page with a reason, so the parent gets a correction rather than a second alert.' };
    }

    let recorded = 0;
    let unchanged = 0;
    let alerted = 0;
    for (const c of clean) {
      if (existing.get(c.userId) === c.status) {
        unchanged += 1;
        continue;
      }
      const r = await recordAttendance({ organizationId: tenant.organizationId, sessionId: session.id, userId: c.userId, status: c.status, source: 'REGISTER', actorId: user.id });
      recorded += 1;
      if (r.alerted !== 'none') alerted += 1;
    }

    const savedAt = new Date();
    await db.liveSession.update({ where: { id: session.id }, data: { registerSubmittedAt: savedAt, registerSubmittedById: user.id } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'register.submitted',
      entity: 'LiveSession',
      entityId: session.id,
      after: { recorded, unchanged, alerted, marked: clean.length, roll: roll.size },
    });

    revalidatePath(`/admin/register/${session.id}`);
    revalidatePath(`/admin/sessions/${session.id}`);
    revalidatePath('/admin/register');
    return { ok: true, recorded, unchanged, alerted, savedAt: savedAt.toISOString(), message: `Saved ${recorded} mark${recorded === 1 ? '' : 's'}${alerted ? `; ${alerted} parent alert${alerted === 1 ? '' : 's'} sent` : ''}.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A correction: the old value, the new one, who, when and why are kept,
 * and a parent who was already told gets a correction notice.
 */
export async function correctAttendance(sessionId: string, userId: string, status: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const found = await sessionInScope(tenant.organizationId, sessionId, user);
    if (!found) return { error: 'Class not found.' };
    const { session, scope } = found;
    if (!isMark(status)) return { error: 'That is not a mark.' };
    const why = reason.trim().slice(0, 300);
    if (!why) return { error: 'Say why, in a few words. It stays on the record and reaches the parent if an alert went out.' };

    const roll = new Set(session.batch ? session.batch.enrollments.map((e) => e.userId) : session.learnerId ? [session.learnerId] : []);
    if (!roll.has(userId)) return { error: 'That learner is not on this class’s roll.' };

    const days = await settingNumber(tenant.organizationId, 'attendance.correctionDays');
    if (!canCorrect(session.startsAt, new Date(), Number.isFinite(days) ? days : 7, scope.kind !== 'batches')) {
      return { error: `Registers older than ${days} days are corrected by the Branch Head. Ask them, with the reason.` };
    }

    const r = await recordAttendance({ organizationId: tenant.organizationId, sessionId: session.id, userId, status, source: 'CORRECTION', actorId: user.id, reason: why });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'attendance.corrected',
      entity: 'Attendance',
      entityId: r.attendanceId,
      before: { status: r.previous },
      after: { status, reason: why, sessionId: session.id, userId },
    });

    revalidatePath(`/admin/register/${session.id}`);
    revalidatePath(`/admin/sessions/${session.id}`);
    return {
      ok: true,
      message:
        r.alerted === 'correction'
          ? 'Corrected. The parents who were told earlier have been sent a correction.'
          : r.alerted === 'alert'
            ? 'Recorded, and the parents have been told.'
            : 'Corrected.',
    };
  } catch (err) {
    return fail(err);
  }
}
