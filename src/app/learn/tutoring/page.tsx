import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { dayKey, formatDateTime, formatDayLabel, todayKey } from '@/lib/clock';
import { Badge, Card, EmptyState } from '@/components/ui';
import { milestoneLabel, openStartTimes, slotLabel, timeField, timeLabel, weekdaysLabel } from '@/lib/tutoring/rules';
import { tutorStates } from '@/lib/tutoring/data';
import { ChooseSlotForm, LearnerFeedbackForm, LearnerLeaveForm } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Online tutor' };

/**
 * A learner's online tutoring: choosing a class time for a course that is
 * offered with a tutor, then the tutor, the time and how far along they
 * are, leave, the feedback asked of them, and the tutor's progress notes.
 */
export default async function LearnerTutoring() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const user = await getSessionUser();
  if (!user) return null;
  const now = new Date();
  const today = todayKey(tenant.timezone);

  const [seats, offers, enrolments, due, notes, leaves] = await Promise.all([
    db.tutoringSeat.findMany({ where: { organizationId, userId: user.id, status: { in: ['WAITING', 'PLACED', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' }, include: { group: true } }),
    db.tutoringOffer.findMany({ where: { organizationId, active: true } }),
    db.enrollment.findMany({ where: { organizationId, userId: user.id, status: { in: ['ENROLLED', 'REGISTERED'] } }, select: { product: { select: { title: true, course: { select: { id: true } } } } } }),
    db.tutoringFeedback.findMany({ where: { organizationId, learnerId: user.id, direction: 'LEARNER', submittedAt: null }, orderBy: { dueAt: 'asc' } }),
    db.tutoringFeedback.findMany({ where: { organizationId, learnerId: user.id, direction: 'TUTOR', submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 12 }),
    db.learnerLeave.findMany({ where: { organizationId, userId: user.id, status: 'APPROVED' }, orderBy: { fromDay: 'desc' }, take: 10 }),
  ]);

  const mine = new Map(enrolments.filter((e) => e.product.course).map((e) => [e.product.course!.id, e.product.title]));
  const taken = new Set(seats.filter((s) => s.status !== 'COMPLETED').map((s) => s.offerId));
  const toChoose = offers.filter((o) => mine.has(o.courseId) && !taken.has(o.id));
  const choices = await Promise.all(
    toChoose.map(async (o) => {
      const tutors = await tutorStates(organizationId, o.id, today);
      const capacity = o.format === 'GROUP' ? Math.max(2, o.groupSize) : 1;
      const times = new Set(openStartTimes(tutors, { weekdays: o.weekdays, minutes: o.classMinutes }));
      /* A group that has not begun and has a seat is a time too, whether or not another tutor is free then. */
      if (capacity > 1) {
        const open = await db.tutoringGroup.findMany({ where: { organizationId, offerId: o.id, status: 'ACTIVE', needsTutor: false, startsOn: { gt: today } }, select: { startMinute: true, capacity: true, _count: { select: { seats: { where: { status: 'PLACED' } } } } } });
        for (const g of open) if (g._count.seats < g.capacity) times.add(g.startMinute);
      }
      return { offer: o, title: mine.get(o.courseId) ?? 'Course', times: [...times].sort((a, b) => a - b).map((m) => ({ value: timeField(m), label: timeLabel(m) })) };
    }),
  );

  const groups = seats.map((s) => s.group).filter((g): g is NonNullable<typeof g> => Boolean(g));
  const [people, courseRows, passed, upcoming, batches] = await Promise.all([
    db.user.findMany({ where: { organizationId, id: { in: [...groups.map((g) => g.tutorId), ...notes.map((n) => n.tutorId)] } }, select: { id: true, name: true } }),
    db.course.findMany({ where: { organizationId, id: { in: offers.map((o) => o.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    groups.length ? db.liveSession.groupBy({ by: ['batchId'], where: { organizationId, batchId: { in: groups.map((g) => g.batchId) }, status: { not: 'CANCELLED' }, endsAt: { lt: now } }, _count: { _all: true } }) : Promise.resolve([]),
    groups.length ? db.liveSession.findMany({ where: { organizationId, batchId: { in: groups.map((g) => g.batchId) }, status: 'SCHEDULED', startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 300, select: { batchId: true, startsAt: true } }) : Promise.resolve([]),
    groups.length ? db.batch.findMany({ where: { organizationId, id: { in: groups.map((g) => g.batchId) } }, select: { id: true, endDate: true } }) : Promise.resolve([]),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const courseOfOffer = new Map(offers.map((o) => [o.id, courseRows.find((c) => c.id === o.courseId)?.product.title ?? 'Course']));
  const passedOf = new Map(passed.map((p) => [p.batchId, p._count._all]));
  const endOf = new Map(batches.map((b) => [b.id, b.endDate]));
  const seatOf = new Map(seats.map((s) => [s.id, s]));

  const nothing = seats.length === 0 && choices.length === 0;

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
        <section key={c.offer.id} className="mt-8">
          <h2 className="text-lg font-semibold">Choose your class time: {c.title}</h2>
          <Card className="mt-3">
            <p className="t-small muted mb-4">
              {c.offer.classesTotal} classes of {c.offer.classMinutes} minutes, {weekdaysLabel(c.offer.weekdays)}, {c.offer.format === 'GROUP' ? `in a group of up to ${c.offer.groupSize}` : 'one to one with your tutor'}.
            </p>
            <ChooseSlotForm offerId={c.offer.id} times={c.times} today={today} days={weekdaysLabel(c.offer.weekdays)} />
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
                  {courseOfOffer.get(seatOf.get(f.seatId)?.offerId ?? '') ?? 'Your course'} <span className="t-small faint">{milestoneLabel(f.milestone)}</span>
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
        const title = courseOfOffer.get(s.offerId) ?? 'Course';
        if (!g) {
          return (
            <section key={s.id} className="mt-8">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Card className="mt-3">
                <Badge tone="warn">finding your tutor</Badge>
                <p className="t-small mt-2">
                  You asked for {timeLabel(s.preferredMinute)} from {formatDayLabel(s.preferredFrom, tenant.timezone, true)}. No tutor is free then yet; you are placed the moment one is, and the office may offer you the nearest time.
                </p>
              </Card>
            </section>
          );
        }
        const done = passedOf.get(g.batchId) ?? 0;
        const next = upcoming.find((u) => u.batchId === g.batchId);
        const end = endOf.get(g.batchId);
        return (
          <section key={s.id} className="mt-8">
            <h2 className="text-lg font-semibold">{title}</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="t-small faint">Your tutor</p>
                    <p className="text-lg font-semibold">{nameOf.get(g.tutorId) ?? 'To be confirmed'}</p>
                    <p className="t-small muted mt-1">
                      {weekdaysLabel(g.weekdays)}, {slotLabel({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes })}
                    </p>
                  </div>
                  {s.status === 'COMPLETED' ? <Badge tone="ok">finished</Badge> : <Badge tone="brand">{g.capacity > 1 ? 'group' : 'one to one'}</Badge>}
                </div>
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, (done / Math.max(1, g.classesTotal)) * 100)}%` }} />
                  </div>
                  <p className="t-small muted mt-2">
                    {Math.min(done, g.classesTotal)} of {g.classesTotal} classes done
                    {end ? ` · finishes ${formatDayLabel(dayKey(end, tenant.timezone), tenant.timezone, true)}` : ''}
                  </p>
                </div>
                {next && s.status === 'PLACED' && (
                  <p className="mt-4">
                    Next class: <b>{formatDateTime(next.startsAt, tenant.timezone)}</b>.{' '}
                    <Link href="/learn/calendar" className="underline">
                      Join from your calendar
                    </Link>
                  </p>
                )}
              </Card>
              {s.status === 'PLACED' && (
                <Card>
                  <p className="mb-3 font-medium">Take leave</p>
                  <LearnerLeaveForm seatId={s.id} today={today} group={g.capacity > 1} />
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
                    {nameOf.get(n.tutorId) ?? 'Your tutor'} · {milestoneLabel(n.milestone)}
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
