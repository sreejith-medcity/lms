import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { dayKey, formatDateTime, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState } from '@/components/ui';
import { learnerTutoringView } from '@/lib/tutoring/learner';
import { ChooseSlotForm, LearnerFeedbackForm, LearnerLeaveForm } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Online tutor' };

/**
 * A learner's online tutoring: choosing a class time for a course that is
 * offered with a tutor, then the tutor, the time and how far along they
 * are, leave, the feedback asked of them, and the tutor's progress notes.
 * The phone app draws the same view from /api/v1/tutoring.
 */
export default async function LearnerTutoring() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const view = await learnerTutoringView(tenant, user.id);
  const { today, choices, seats, notes } = view;
  const due = view.feedbackDue;
  const leaves = view.leave;
  const nothing = !view.applies;

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <h1 className="text-2xl font-semibold tracking-tight">Online tutor</h1>
      <p className="muted mt-1">Your tutor, your class time, leave and feedback.</p>

      {nothing && (
        <div className="mt-6">
          <EmptyState title="No online tutoring yet" hint="When you are on a course that is taught with an online tutor, you choose your class time here." />
        </div>
      )}

      {choices.map((c) => (
        <section key={c.offerId} className="mt-8">
          <h2 className="text-lg font-semibold">Choose your class time: {c.title}</h2>
          <Card className="mt-3">
            <p className="t-small muted mb-4">
              {c.classesTotal} classes of {c.classMinutes} minutes, {c.days}, {c.format === 'GROUP' ? `in a group of up to ${c.groupSize}` : 'one to one with your tutor'}.
            </p>
            <ChooseSlotForm offerId={c.offerId} times={c.times} today={today} days={c.days} />
          </Card>
        </section>
      ))}

      {due.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">How are your classes going?</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {due.map((f) => (
              <Card key={f.id}>
                <p className="font-medium">
                  {f.title} <span className="t-small faint">{f.when}</span>
                </p>
                <p className="t-small muted mb-3">This goes to the office, not to your tutor&apos;s inbox.</p>
                <LearnerFeedbackForm feedbackId={f.id} />
              </Card>
            ))}
          </div>
        </section>
      )}

      {seats.map((s) => {
        const g = s.group;
        const title = s.title;
        if (!g) {
          return (
            <section key={s.id} className="mt-8">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Card className="mt-3">
                <Badge tone="warn">finding your tutor</Badge>
                <p className="t-small mt-2">
                  You asked for {s.askedTime} from {formatDayLabel(s.askedFrom, tenant.timezone, true)}. No tutor is free then yet; you are placed the moment one is, and the office may offer you the nearest time.
                </p>
              </Card>
            </section>
          );
        }
        return (
          <section key={s.id} className="mt-8">
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="t-small faint">Your tutor</p>
                    <p className="text-lg font-semibold">{g.tutor}</p>
                    <p className="t-small muted mt-1">
                      {g.days}, {g.time}
                    </p>
                  </div>
                  {s.status === 'COMPLETED' ? <Badge tone="ok">finished</Badge> : <Badge tone="brand">{g.oneToOne ? 'one to one' : 'group'}</Badge>}
                </div>
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, (g.classesDone / Math.max(1, g.classesTotal)) * 100)}%` }} />
                  </div>
                  <p className="t-small muted mt-2">
                    {g.classesDone} of {g.classesTotal} classes done
                    {g.finishesOn ? ` · finishes ${formatDayLabel(g.finishesOn, tenant.timezone, true)}` : ''}
                  </p>
                </div>
                {g.nextClassAt && s.status === 'PLACED' && (
                  <p className="mt-4">
                    Next class: <b>{formatDateTime(g.nextClassAt, tenant.timezone)}</b>.{' '}
                    <Link href="/learn/calendar" className="underline">
                      Join from your calendar
                    </Link>
                  </p>
                )}
              </Card>
              {s.status === 'PLACED' && (
                <Card>
                  <p className="mb-3 font-medium">Take leave</p>
                  <LearnerLeaveForm seatId={s.id} today={today} group={!g.oneToOne} />
                </Card>
              )}
            </div>
          </section>
        );
      })}

      {notes.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Progress notes from your tutor</h2>
          <ul className="mt-3 space-y-3">
            {notes.map((n) => (
              <li key={n.id}>
                <Card>
                  <p className="t-small faint">
                    {n.tutor} · {n.when}
                    {n.submittedAt ? ` · ${formatDayLabel(dayKey(n.submittedAt, tenant.timezone), tenant.timezone)}` : ''}
                  </p>
                  <p className="mt-1">
                    <Badge tone={(n.rating ?? 0) >= 4 ? 'ok' : (n.rating ?? 0) <= 2 ? 'warn' : 'neutral'}>Progress {n.rating} / 5</Badge>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">{n.comment}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {leaves.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your leave</h2>
          <ul className="t-small mt-3 divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
            {leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>{l.fromDay === l.toDay ? formatDayLabel(l.fromDay, tenant.timezone, true) : `${formatDayLabel(l.fromDay, tenant.timezone)} to ${formatDayLabel(l.toDay, tenant.timezone)}`}</span>
                <span className="faint">{l.classesMoved ? `${l.classesMoved} ${l.classesMoved === 1 ? 'class' : 'classes'} moved to the end` : 'marked excused'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
