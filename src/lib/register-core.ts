import { db } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { canSeeBatch, staffScope } from '@/lib/scope';
import { recordAttendance } from '@/lib/attendance';
import { canCorrect, isMark, unrecordedState, type Mark } from '@/lib/attendance-rules';
import { settingNumber } from '@/lib/settings/store';
import { formatTime } from '@/lib/clock';

/**
 * The register, behind both doors.
 *
 * The web page and the app call the same three things: read a class's
 * register, confirm marks, correct one with a reason. The person is a
 * `SessionUser` however they signed in, so scope and permission checks
 * are the same and a phone cannot reach a class a laptop could not.
 */

export type RegisterOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

async function sessionInScope(organizationId: string, sessionId: string, user: SessionUser) {
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

export interface RegisterSheetData {
  session: { id: string; title: string; startsAt: Date; endsAt: Date; status: string; batch: { id: string; name: string; mode: string } };
  confirmed: boolean;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  started: boolean;
  off: boolean;
  online: boolean;
  confirmedStarted: boolean;
  unrecordedLabel: string;
  canEdit: boolean;
  mayCorrect: boolean;
  correctionDays: number;
  roster: { userId: string; name: string; recorded: Mark | null; source: string | null; joinedAt: string | null; note: string | null }[];
  history: { userId: string; from: Mark | null; to: Mark; reason: string; source: string; at: Date; by: string | null }[];
}

/** Everything a register screen shows, or null when the class is outside the person's scope. */
export async function registerSheet(organizationId: string, timezone: string, user: SessionUser, sessionId: string, now = new Date()): Promise<RegisterSheetData | null> {
  const canEdit = user.permissions['scheduling.sessions']?.edit ?? false;
  const scope = await staffScope(user);
  const session = await db.liveSession.findFirst({
    where: { id: sessionId, organizationId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      isHoliday: true,
      registerSubmittedAt: true,
      registerSubmittedById: true,
      batch: {
        select: {
          id: true,
          name: true,
          branchId: true,
          mode: true,
          enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED'] } }, orderBy: { user: { name: 'asc' } }, select: { user: { select: { id: true, name: true } } } },
        },
      },
      attendances: { select: { userId: true, status: true, source: true, joinedAt: true, recordedAt: true, note: true } },
    },
  });
  if (!session || !session.batch || !canSeeBatch(scope, session.batch)) return null;

  const [changes, submitter, correctionDaysRaw] = await Promise.all([
    db.attendanceChange.findMany({
      where: { organizationId, sessionId: session.id },
      orderBy: { changedAt: 'desc' },
      take: 50,
      select: { userId: true, fromStatus: true, toStatus: true, reason: true, source: true, changedAt: true, changedById: true },
    }),
    session.registerSubmittedById ? db.user.findFirst({ where: { id: session.registerSubmittedById, organizationId }, select: { name: true } }) : null,
    settingNumber(organizationId, 'attendance.correctionDays'),
  ]);
  const correctionDays = Number.isFinite(correctionDaysRaw) ? correctionDaysRaw : 7;
  const changerIds = Array.from(new Set(changes.map((c) => c.changedById).filter((x): x is string => Boolean(x))));
  const changers = changerIds.length ? new Map((await db.user.findMany({ where: { id: { in: changerIds }, organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();

  const byUser = new Map(session.attendances.map((a) => [a.userId, a]));
  const ended = session.endsAt < now || session.status === 'COMPLETED';
  const online = session.batch.mode === 'ONLINE' || session.batch.mode === 'HYBRID';
  const confirmedStarted = session.status === 'LIVE' || session.status === 'COMPLETED';

  return {
    session: { id: session.id, title: session.title, startsAt: session.startsAt, endsAt: session.endsAt, status: session.status, batch: { id: session.batch.id, name: session.batch.name, mode: session.batch.mode } },
    confirmed: Boolean(session.registerSubmittedAt),
    confirmedAt: session.registerSubmittedAt,
    confirmedBy: submitter?.name ?? null,
    started: session.startsAt <= now,
    off: session.status === 'CANCELLED' || session.isHoliday,
    online,
    confirmedStarted,
    unrecordedLabel: unrecordedState({ mode: session.batch.mode, confirmedStarted, ended }),
    canEdit,
    mayCorrect: canEdit && canCorrect(session.startsAt, now, correctionDays, scope.kind !== 'batches'),
    correctionDays,
    roster: session.batch.enrollments.map((e) => {
      const a = byUser.get(e.user.id);
      return {
        userId: e.user.id,
        name: e.user.name,
        recorded: (a?.status as Mark | undefined) ?? null,
        source: a?.source ?? null,
        joinedAt: a?.joinedAt ? formatTime(a.joinedAt, timezone) : null,
        note: a?.note ?? null,
      };
    }),
    history: changes.map((c) => ({ userId: c.userId, from: (c.fromStatus as Mark | null) ?? null, to: c.toStatus as Mark, reason: c.reason, source: c.source, at: c.changedAt, by: c.changedById ? (changers.get(c.changedById) ?? null) : null })),
  };
}

export interface RegisterSubmitResult {
  recorded: number;
  unchanged: number;
  alerted: number;
  savedAt: string;
  message: string;
}

/** Confirm the marks the teacher made. Silence stays unrecorded; nothing turns it into an absence. */
export async function submitRegisterAs(organizationId: string, user: SessionUser, sessionId: string, marks: { userId: string; status: string }[]): Promise<RegisterOutcome<RegisterSubmitResult>> {
  if (!user.permissions['scheduling.sessions']?.edit) return { ok: false, error: 'You do not have permission to do that.' };
  const found = await sessionInScope(organizationId, sessionId, user);
  if (!found) return { ok: false, error: 'Class not found.' };
  const { session } = found;
  if (session.status === 'CANCELLED' || session.isHoliday) return { ok: false, error: 'That class was called off, so there is no register to keep.' };
  if (session.startsAt > new Date()) return { ok: false, error: 'That class has not started yet.' };

  const roll = new Set(session.batch ? session.batch.enrollments.map((e) => e.userId) : session.learnerId ? [session.learnerId] : []);
  const clean: { userId: string; status: Mark }[] = [];
  for (const m of marks) {
    if (!roll.has(m.userId)) continue;
    if (!isMark(m.status)) return { ok: false, error: 'One of the marks is not Present, Absent, Late or Excused.' };
    clean.push({ userId: m.userId, status: m.status });
  }
  if (clean.length === 0) return { ok: false, error: 'Nobody is marked. Mark at least one learner, then submit.' };

  // Once a register has been confirmed, a different mark is a correction
  // and needs a reason; the register itself only records what is new.
  const existing = new Map(
    (await db.attendance.findMany({ where: { sessionId: session.id, userId: { in: clean.map((c) => c.userId) }, session: { organizationId } }, select: { userId: true, status: true } })).map((a) => [a.userId, a.status as Mark]),
  );
  if (session.registerSubmittedAt && clean.some((c) => existing.has(c.userId) && existing.get(c.userId) !== c.status)) {
    return { ok: false, error: 'This register was already confirmed. Change a mark from the class page with a reason, so the parent gets a correction rather than a second alert.' };
  }

  let recorded = 0;
  let unchanged = 0;
  let alerted = 0;
  for (const c of clean) {
    if (existing.get(c.userId) === c.status) {
      unchanged += 1;
      continue;
    }
    const r = await recordAttendance({ organizationId, sessionId: session.id, userId: c.userId, status: c.status, source: 'REGISTER', actorId: user.id });
    recorded += 1;
    if (r.alerted !== 'none') alerted += 1;
  }

  const savedAt = new Date();
  await db.liveSession.update({ where: { id: session.id }, data: { registerSubmittedAt: savedAt, registerSubmittedById: user.id } });
  await recordAudit({
    organizationId,
    actorId: user.id,
    action: 'register.submitted',
    entity: 'LiveSession',
    entityId: session.id,
    after: { recorded, unchanged, alerted, marked: clean.length, roll: roll.size },
  });
  return {
    ok: true,
    value: { recorded, unchanged, alerted, savedAt: savedAt.toISOString(), message: `Saved ${recorded} mark${recorded === 1 ? '' : 's'}${alerted ? `; ${alerted} parent alert${alerted === 1 ? '' : 's'} sent` : ''}.` },
  };
}

/** A correction: old value, new value, who, when and why are kept; a parent already told gets a correction. */
export async function correctAttendanceAs(organizationId: string, user: SessionUser, sessionId: string, userId: string, status: string, reason: string): Promise<RegisterOutcome<{ message: string }>> {
  if (!user.permissions['scheduling.sessions']?.edit) return { ok: false, error: 'You do not have permission to do that.' };
  const found = await sessionInScope(organizationId, sessionId, user);
  if (!found) return { ok: false, error: 'Class not found.' };
  const { session, scope } = found;
  if (!isMark(status)) return { ok: false, error: 'That is not a mark.' };
  const why = reason.trim().slice(0, 300);
  if (!why) return { ok: false, error: 'Say why, in a few words. It stays on the record and reaches the parent if an alert went out.' };

  const roll = new Set(session.batch ? session.batch.enrollments.map((e) => e.userId) : session.learnerId ? [session.learnerId] : []);
  if (!roll.has(userId)) return { ok: false, error: 'That learner is not on this class’s roll.' };

  const days = await settingNumber(organizationId, 'attendance.correctionDays');
  if (!canCorrect(session.startsAt, new Date(), Number.isFinite(days) ? days : 7, scope.kind !== 'batches')) {
    return { ok: false, error: `Registers older than ${days} days are corrected by the Branch Head. Ask them, with the reason.` };
  }

  const r = await recordAttendance({ organizationId, sessionId: session.id, userId, status, source: 'CORRECTION', actorId: user.id, reason: why });
  await recordAudit({
    organizationId,
    actorId: user.id,
    action: 'attendance.corrected',
    entity: 'Attendance',
    entityId: r.attendanceId,
    before: { status: r.previous },
    after: { status, reason: why, sessionId: session.id, userId },
  });
  return {
    ok: true,
    value: {
      message:
        r.alerted === 'correction'
          ? 'Corrected. The parents who were told earlier have been sent a correction.'
          : r.alerted === 'alert'
            ? 'Recorded, and the parents have been told.'
            : 'Corrected.',
    },
  };
}
