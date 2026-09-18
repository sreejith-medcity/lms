import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { happened } from '@/lib/events';
import { settingBool, settingNumber } from '@/lib/settings/store';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { alertKey, alerts, correctionNotice, parentLine, type Mark } from '@/lib/attendance-rules';

/**
 * Every write to attendance goes through `recordAttendance`, whichever
 * door it came in by (a learner pressing Join, Zoom's webhook, a teacher's
 * register, a correction). One place decides three things: whether this is
 * a first record or a change, what the change history says, and what the
 * parents are told. The alert is decided by the saved status, after the
 * save; a failed write sends nothing.
 */

export interface RecordInput {
  organizationId: string;
  sessionId: string;
  userId: string;
  status: Mark;
  source: $Enums.AttendanceSource;
  actorId?: string | null;
  /** Required for a correction; kept on the change row. */
  reason?: string | null;
  note?: string | null;
  joinedAt?: Date | null;
  wasInTime?: boolean;
}

export interface RecordResult {
  attendanceId: string;
  previous: Mark | null;
  changed: boolean;
  alerted: 'none' | 'alert' | 'correction';
}

export async function recordAttendance(input: RecordInput): Promise<RecordResult> {
  const existing = await db.attendance.findUnique({
    where: { sessionId_userId: { sessionId: input.sessionId, userId: input.userId } },
    select: { id: true, status: true, session: { select: { organizationId: true } } },
  });
  if (existing && existing.session.organizationId !== input.organizationId) throw new Error('FORBIDDEN');

  const previous = (existing?.status as Mark | undefined) ?? null;
  const now = new Date();
  const row = existing
    ? await db.attendance.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          source: input.source,
          markedById: input.actorId ?? undefined,
          note: input.note ?? undefined,
          recordedAt: now,
          ...(input.joinedAt ? { joinedAt: input.joinedAt } : {}),
          ...(input.wasInTime !== undefined ? { wasInTime: input.wasInTime } : {}),
        },
        select: { id: true },
      })
    : await db.attendance.create({
        data: {
          sessionId: input.sessionId,
          userId: input.userId,
          status: input.status,
          source: input.source,
          markedById: input.actorId ?? null,
          note: input.note ?? null,
          joinedAt: input.joinedAt ?? null,
          wasInTime: input.wasInTime ?? input.status === 'PRESENT',
        },
        select: { id: true },
      });

  const changed = previous !== null && previous !== input.status;
  if (changed || input.source === 'CORRECTION') {
    await db.attendanceChange.create({
      data: {
        organizationId: input.organizationId,
        attendanceId: row.id,
        sessionId: input.sessionId,
        userId: input.userId,
        fromStatus: previous,
        toStatus: input.status,
        reason: input.reason?.trim() || (input.source === 'PROVIDER' ? 'Reported by the class platform' : input.source === 'REGISTER' ? 'Register' : 'Recorded'),
        source: input.source,
        changedById: input.actorId ?? null,
      },
    });
  }

  const owed = previous === input.status ? 'none' : correctionNotice(previous, input.status);
  if (owed !== 'none') await alertParents({ organizationId: input.organizationId, sessionId: input.sessionId, userId: input.userId, status: input.status, previous, kind: owed });

  return { attendanceId: row.id, previous, changed, alerted: owed };
}

/**
 * Tell the linked parents. One notification per parent, class and status
 * event: the inbox row is created first with a unique key, and the outside
 * channels are queued only for rows that were actually new, so a register
 * saved twice sends once.
 */
export async function alertParents(input: { organizationId: string; sessionId: string; userId: string; status: Mark; previous: Mark | null; kind: 'alert' | 'correction' }): Promise<number> {
  if (!(await settingBool(input.organizationId, 'attendance.parentAlerts'))) return 0;
  if (input.kind === 'alert' && !alerts(input.status)) return 0;

  const [links, session, learner, organization] = await Promise.all([
    db.parentLink.findMany({ where: { organizationId: input.organizationId, learnerId: input.userId, status: 'ACTIVE' }, select: { contact: true, name: true } }),
    db.liveSession.findFirst({ where: { id: input.sessionId, organizationId: input.organizationId }, select: { title: true, startsAt: true, batch: { select: { name: true } } } }),
    db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId }, select: { name: true } }),
    db.organization.findUnique({ where: { id: input.organizationId }, select: { timezone: true, name: true } }),
  ]);
  if (!links.length || !session || !learner) return 0;

  const tz = organization?.timezone || 'Asia/Kolkata';
  const when = `${formatDayLabel(dayKey(session.startsAt, tz), tz)} at ${formatTime(session.startsAt, tz)}`;
  const line = parentLine({
    learner: learner.name,
    status: input.status,
    title: session.title,
    when,
    corrected: input.kind === 'correction' && input.previous ? { from: input.previous } : undefined,
  });
  const key = input.kind === 'correction' ? `${alertKey(input.sessionId, input.userId, input.status)}:from:${input.previous}` : alertKey(input.sessionId, input.userId, input.status);
  const eventKey = input.kind === 'correction' ? 'attendance.corrected' : input.status === 'LATE' ? 'attendance.late' : 'attendance.absent';

  const created = await db.parentNotification.createMany({
    data: links.map((l) => ({
      organizationId: input.organizationId,
      contact: l.contact,
      learnerId: input.userId,
      kind: eventKey,
      title: line.title,
      body: line.body,
      href: `/parent/${input.userId}`,
      dedupeKey: `${key}:${l.contact}`,
    })),
    skipDuplicates: true,
  });
  if (created.count === 0) return 0;

  // Which contacts were new: the ones whose row now carries this key.
  const fresh = await db.parentNotification.findMany({
    where: { organizationId: input.organizationId, dedupeKey: { in: links.map((l) => `${key}:${l.contact}`) }, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { contact: true },
  });
  const freshContacts = new Set(fresh.map((f) => f.contact));
  const recipients = links.filter((l) => freshContacts.has(l.contact)).map((l) => ({ userId: null, email: l.contact.includes('@') ? l.contact : null, phone: l.contact.includes('@') ? null : l.contact, name: l.name }));

  await queueNotifications({
    organizationId: input.organizationId,
    eventKey,
    recipients: recipients.map(({ name: _n, ...r }) => r),
    context: { learner: learner.name, title: session.title, date: when, status: input.status.toLowerCase(), was: (input.previous ?? '').toLowerCase(), batch: session.batch?.name ?? '', organization: organization?.name ?? '' },
    contextFor: (person) => ({ name: recipients.find((r) => r.email === person.email && r.phone === person.phone)?.name ?? 'Parent' }),
  });

  await happened({
    organizationId: input.organizationId,
    key: eventKey,
    userId: input.userId,
    subjectId: input.sessionId,
    data: { status: input.status, previous: input.previous ?? '', parents: String(recipients.length) },
  });
  return recipients.length;
}

/** The late threshold for a class: the program's, else the academy's. */
export async function lateAfterMinutes(organizationId: string, batchId: string | null): Promise<number> {
  const fromProgram = batchId
    ? (await db.batch.findFirst({ where: { id: batchId, organizationId }, select: { course: { select: { program: { select: { lateAfterMinutes: true } } } } } }))?.course.program?.lateAfterMinutes ?? null
    : null;
  if (fromProgram !== null && fromProgram !== undefined) return fromProgram;
  const n = await settingNumber(organizationId, 'attendance.lateAfterMinutes');
  return Number.isFinite(n) ? n : 10;
}

export async function onlineAbsentAfterMinutes(organizationId: string, batchId: string | null): Promise<number> {
  const fromProgram = batchId
    ? (await db.batch.findFirst({ where: { id: batchId, organizationId }, select: { course: { select: { program: { select: { onlineAbsentAfterMinutes: true } } } } } }))?.course.program?.onlineAbsentAfterMinutes ?? null
    : null;
  if (fromProgram !== null && fromProgram !== undefined) return fromProgram;
  const n = await settingNumber(organizationId, 'attendance.onlineAbsentAfterMinutes');
  return Number.isFinite(n) && n > 0 ? n : 20;
}
