import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { WEEKDAY_LABELS, dayKey, formatDateTime, formatDayLabel, todayKey } from '@/lib/clock';
import { hoursLabel, monthWindow } from '@/lib/payouts';
import { Badge, Card, EmptyState, PageHeader, Section, Table, Row, Cell } from '@/components/ui';
import { milestoneLabel, slotLabel, timeField, timeLabel, weekdaysLabel } from '@/lib/tutoring/rules';
import { tutorHours } from '@/lib/tutoring/data';
import { AvailabilityForm, RemoveAvailability, SlotForm, TutorLeaveForm, TutorNoteForm, WithdrawLeave } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Online tutoring', robots: { index: false, follow: false } };

const LEAVE_TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad', WITHDRAWN: 'neutral' } as const;

/**
 * A tutor's own online tutoring: the hours they can teach, their groups,
 * their leave, the progress notes that are due, and the hours they have
 * taught this month. Nothing here needs a permission beyond being staff.
 */
export default async function MyTutoring() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const me = await requireStaff();
  const now = new Date();
  const today = todayKey(tenant.timezone);
  const monthKey = dayKey(now, tenant.timezone).slice(0, 7);
  const month = monthWindow(monthKey, tenant.timezone)!;

  const [windows, groups, leaves, notes, hours] = await Promise.all([
    db.tutorAvailability.findMany({ where: { organizationId, userId: me.id }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
    db.tutoringGroup.findMany({ where: { organizationId, tutorId: me.id, status: 'ACTIVE' }, orderBy: { startMinute: 'asc' }, include: { offer: { select: { courseId: true } }, seats: { where: { status: 'PLACED' }, select: { userId: true } } } }),
    db.tutorLeave.findMany({ where: { organizationId, userId: me.id }, orderBy: { fromDay: 'desc' }, take: 12 }),
    db.tutoringFeedback.findMany({ where: { organizationId, tutorId: me.id, direction: 'TUTOR', submittedAt: null }, orderBy: { dueAt: 'asc' }, take: 30 }),
    tutorHours(organizationId, month.from, month.to, tenant.timezone, now),
  ]);
  const [courses, people, next] = await Promise.all([
    db.course.findMany({ where: { organizationId, id: { in: groups.map((g) => g.offer.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, id: { in: [...groups.flatMap((g) => g.seats.map((s) => s.userId)), ...notes.map((n) => n.learnerId)] } }, select: { id: true, name: true } }),
    groups.length
      ? db.liveSession.findMany({ where: { organizationId, batchId: { in: groups.map((g) => g.batchId) }, status: 'SCHEDULED', startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 200, select: { id: true, batchId: true, startsAt: true } })
      : Promise.resolve([]),
  ]);
  const titleOf = new Map(courses.map((c) => [c.id, c.product.title]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const mine = hours.find((h) => h.userId === me.id);

  return (
    <div className="space-y-8">
      <PageHeader title="Online tutoring" description="Mark the hours you can teach online, and learners are placed with you inside them. Your groups, your leave and your progress notes are here." />
      <p className="t-small">
        <Link href="/admin/desk" className="underline">
          My teaching
        </Link>{' '}
        / Online tutoring
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <Section title="My groups">
            {groups.length === 0 ? (
              <EmptyState title="No online learners yet" hint="Once you have marked your hours and the office has put you on a course, learners are placed with you by themselves." />
            ) : (
              <div className="space-y-4">
                {groups.map((g) => {
                  const coming = next.find((s) => s.batchId === g.batchId);
                  return (
                    <Card key={g.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{titleOf.get(g.offer.courseId) ?? 'Course'}</p>
                          <p className="t-small muted">
                            {weekdaysLabel(g.weekdays)}, {slotLabel({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes })}
                          </p>
                          <p className="t-small mt-1">{g.seats.map((s) => nameOf.get(s.userId) ?? 'Learner').join(', ') || 'No learner yet'}</p>
                          {coming && <p className="t-small faint mt-1">Next class {formatDateTime(coming.startsAt, tenant.timezone)}</p>}
                        </div>
                        <Link href={`/admin/batches/${g.batchId}`} className="t-small underline">
                          Register and join link
                        </Link>
                      </div>
                      <details className="mt-3">
                        <summary className="t-small cursor-pointer underline">I am not free at this time: move the class</summary>
                        <div className="mt-3">
                          <SlotForm groupId={g.id} time={timeField(g.startMinute)} today={today} />
                        </div>
                      </details>
                    </Card>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Progress notes due">
            {notes.length === 0 ? (
              <p className="t-small muted">None due. A note is asked for after a learner&apos;s 5th, 10th and 15th class and at the end.</p>
            ) : (
              <div className="space-y-4">
                {notes.map((n) => (
                  <Card key={n.id}>
                    <p className="font-medium">
                      {nameOf.get(n.learnerId) ?? 'Learner'} <span className="t-small faint">{milestoneLabel(n.milestone)}</span>
                    </p>
                    <div className="mt-3">
                      <TutorNoteForm feedbackId={n.id} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-8">
          <Section title={`Hours taught, ${month.label}`}>
            <Card>
              <p className="text-2xl font-semibold tabular-nums">{hoursLabel(mine?.minutes ?? 0)}</p>
              <p className="t-small muted">{mine?.classes ?? 0} online classes held</p>
              {mine && mine.unconfirmed > 0 && (
                <p className="t-small mt-2 text-[var(--warn)]">
                  {mine.unconfirmed} {mine.unconfirmed === 1 ? 'class has' : 'classes have'} passed with no register. Submit the register and they count.
                </p>
              )}
            </Card>
          </Section>

          <Section title="Hours I can teach online">
            <Card>
              {windows.length === 0 ? (
                <p className="t-small text-[var(--warn)]">You have marked no hours, so no learner can be placed with you.</p>
              ) : (
                <ul className="t-small space-y-1">
                  {windows.map((w) => (
                    <li key={w.id} className="flex justify-between gap-3">
                      <span>
                        {WEEKDAY_LABELS[w.weekday]} {timeLabel(w.startMinute)} to {timeLabel(w.endMinute)}
                      </span>
                      <RemoveAvailability id={w.id} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t pt-4">
                <AvailabilityForm />
              </div>
              <p className="t-small faint mt-3">Removing hours does not move a group you already have: use &quot;move the class&quot; on the group, or ask for leave.</p>
            </Card>
          </Section>

          <Section title="Leave">
            <Card>
              <TutorLeaveForm today={today} />
            </Card>
            {leaves.length > 0 && (
              <Table head={['Days', 'State', '']}>
                {leaves.map((l) => (
                  <Row key={l.id}>
                    <Cell className="t-small">{l.fromDay === l.toDay ? formatDayLabel(l.fromDay, tenant.timezone, true) : `${formatDayLabel(l.fromDay, tenant.timezone)} to ${formatDayLabel(l.toDay, tenant.timezone)}`}</Cell>
                    <Cell>
                      <Badge tone={LEAVE_TONE[l.status as keyof typeof LEAVE_TONE] ?? 'neutral'}>{l.status === 'PENDING' ? 'waiting for the office' : l.status.toLowerCase()}</Badge>
                    </Cell>
                    <Cell className="text-right">{l.status === 'PENDING' && <WithdrawLeave leaveId={l.id} />}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
