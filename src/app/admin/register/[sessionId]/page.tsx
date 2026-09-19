import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { registerSheet } from '@/lib/register-core';
import { RegisterSheet } from './sheet';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function RegisterPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('scheduling.sessions', 'view');
  const tz = tenant.timezone;

  const d = await registerSheet(tenant.organizationId, tz, me, sessionId);
  if (!d) notFound();
  const { session } = d;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <Link href="/admin/register" className="t-small faint hover:underline">
          Register
        </Link>
        <h1 className="t-title mt-1">{session.title}</h1>
        <p className="t-small faint mt-1">
          {session.batch.name} · {formatDayLabel(dayKey(session.startsAt, tz), tz, true)}, {formatTime(session.startsAt, tz)} to {formatTime(session.endsAt, tz)}
          {d.online ? ' · online' : ''}
        </p>
        {d.confirmedAt && (
          <p className="t-small mt-1 text-[var(--ok)]">
            Confirmed {formatDayLabel(dayKey(d.confirmedAt, tz), tz)} at {formatTime(d.confirmedAt, tz)}
            {d.confirmedBy ? ` by ${d.confirmedBy}` : ''}.
          </p>
        )}
      </div>

      {d.off ? (
        <p className="t-small muted">This class was called off. There is no register to keep, and nobody is marked absent for it.</p>
      ) : !d.started ? (
        <p className="t-small muted">This class has not started yet. The register opens at {formatTime(session.startsAt, tz)}.</p>
      ) : (
        <RegisterSheet
          sessionId={session.id}
          roster={d.roster}
          confirmed={d.confirmed}
          canEdit={d.canEdit}
          mayCorrect={d.mayCorrect}
          correctionDays={d.correctionDays}
          online={d.online}
          unrecordedLabel={d.unrecordedLabel}
          confirmedStarted={d.confirmedStarted}
          history={d.history.map((c) => ({
            who: d.roster.find((r) => r.userId === c.userId)?.name ?? 'Learner',
            from: c.from,
            to: c.to,
            reason: c.reason,
            source: c.source,
            at: `${formatDayLabel(dayKey(c.at, tz), tz)} ${formatTime(c.at, tz)}`,
            by: c.by ?? (c.source === 'PROVIDER' ? 'the class platform' : null),
          }))}
        />
      )}
    </div>
  );
}
