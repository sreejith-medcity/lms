import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { canSeeBatch, staffScope } from '@/lib/scope';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { settingNumber } from '@/lib/settings/store';
import { canCorrect, unrecordedState, type Mark } from '@/lib/attendance-rules';
import { RegisterSheet } from './sheet';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function RegisterPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('scheduling.sessions', 'view');
  const canEdit = me.permissions['scheduling.sessions']?.edit ?? false;
  const scope = await staffScope(me);
  const tz = tenant.timezone;

  const session = await db.liveSession.findFirst({
    where: { id: sessionId, organizationId: tenant.organizationId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      isHoliday: true,
      registerSubmittedAt: true,
      registerSubmittedById: true,
      provider: true,
      providerMeetingId: true,
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
  if (!session || !session.batch || !canSeeBatch(scope, session.batch)) notFound();

  const [changes, submitter, correctionDays] = await Promise.all([
    db.attendanceChange.findMany({
      where: { organizationId: tenant.organizationId, sessionId: session.id },
      orderBy: { changedAt: 'desc' },
      take: 50,
      select: { userId: true, fromStatus: true, toStatus: true, reason: true, source: true, changedAt: true, changedById: true },
    }),
    session.registerSubmittedById ? db.user.findFirst({ where: { id: session.registerSubmittedById, organizationId: tenant.organizationId }, select: { name: true } }) : null,
    settingNumber(tenant.organizationId, 'attendance.correctionDays'),
  ]);
  const changerIds = Array.from(new Set(changes.map((c) => c.changedById).filter((x): x is string => Boolean(x))));
  const changers = changerIds.length ? new Map((await db.user.findMany({ where: { id: { in: changerIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();

  const byUser = new Map(session.attendances.map((a) => [a.userId, a]));
  const now = new Date();
  const ended = session.endsAt < now || session.status === 'COMPLETED';
  const online = session.batch.mode === 'ONLINE' || session.batch.mode === 'HYBRID';
  const confirmedStarted = session.status === 'LIVE' || session.status === 'COMPLETED';
  const unrecorded = unrecordedState({ mode: session.batch.mode, confirmedStarted, ended });

  const roster = session.batch.enrollments.map((e) => {
    const a = byUser.get(e.user.id);
    return {
      userId: e.user.id,
      name: e.user.name,
      recorded: (a?.status as Mark | undefined) ?? null,
      source: a?.source ?? null,
      joinedAt: a?.joinedAt ? formatTime(a.joinedAt, tz) : null,
      note: a?.note ?? null,
    };
  });

  const started = session.startsAt <= now;
  const off = session.status === 'CANCELLED' || session.isHoliday;
  const mayCorrect = canEdit && canCorrect(session.startsAt, now, Number.isFinite(correctionDays) ? correctionDays : 7, scope.kind !== 'batches');

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <Link href="/admin/register" className="t-small faint hover:underline">
          Register
        </Link>
        <h1 className="t-title mt-1">{session.title}</h1>
        <p className="t-small faint mt-1">
          {session.batch.name} · {formatDayLabel(dayKey(session.startsAt, tz), tz, true)}, {formatTime(session.startsAt, tz)} to {formatTime(session.endsAt, tz)}
          {online ? ' · online' : ''}
        </p>
        {session.registerSubmittedAt && (
          <p className="t-small mt-1 text-[var(--ok)]">
            Confirmed {formatDayLabel(dayKey(session.registerSubmittedAt, tz), tz)} at {formatTime(session.registerSubmittedAt, tz)}
            {submitter ? ` by ${submitter.name}` : ''}.
          </p>
        )}
      </div>

      {off ? (
        <p className="t-small muted">This class was called off. There is no register to keep, and nobody is marked absent for it.</p>
      ) : !started ? (
        <p className="t-small muted">This class has not started yet. The register opens at {formatTime(session.startsAt, tz)}.</p>
      ) : (
        <RegisterSheet
          sessionId={session.id}
          roster={roster}
          confirmed={Boolean(session.registerSubmittedAt)}
          canEdit={canEdit}
          mayCorrect={mayCorrect}
          correctionDays={Number.isFinite(correctionDays) ? correctionDays : 7}
          online={online}
          unrecordedLabel={unrecorded}
          confirmedStarted={confirmedStarted}
          history={changes.map((c) => ({
            who: roster.find((r) => r.userId === c.userId)?.name ?? 'Learner',
            from: c.fromStatus,
            to: c.toStatus,
            reason: c.reason,
            source: c.source,
            at: `${formatDayLabel(dayKey(c.changedAt, tz), tz)} ${formatTime(c.changedAt, tz)}`,
            by: c.changedById ? (changers.get(c.changedById) ?? null) : c.source === 'PROVIDER' ? 'the class platform' : null,
          }))}
        />
      )}
    </div>
  );
}
