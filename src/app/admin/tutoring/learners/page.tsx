import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { dayKey, formatDayLabel, todayKey } from '@/lib/clock';
import { Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { freeEnrolments, timeField, timeLabel } from '@/lib/tutoring/rules';
import { EnrolTutoringForm, WaitingActions } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';

export default async function TutoringLearners() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const user = await requireStaff('scheduling.sessions', 'view');
  const mayEdit = can(user.permissions, 'scheduling.sessions', 'edit');
  const [offers, waiting] = await Promise.all([
    db.tutoringOffer.findMany({ where: { organizationId, active: true }, include: { tutors: { select: { userId: true } } } }),
    db.tutoringSeat.findMany({ where: { organizationId, status: 'WAITING' }, orderBy: { createdAt: 'asc' }, take: 200 }),
  ]);
  const [courses, people] = await Promise.all([
    db.course.findMany({ where: { organizationId, id: { in: offers.map((o) => o.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, id: { in: [...offers.flatMap((o) => o.tutors.map((t) => t.userId)), ...waiting.map((w) => w.userId)] } }, select: { id: true, name: true, email: true, phone: true } }),
  ]);
  const titleOf = new Map(courses.map((c) => [c.id, c.product.title]));
  const who = new Map(people.map((p) => [p.id, p]));

  /*
   * Enrolled on a course taught with a tutor, and no class time yet: they
   * have not chosen one, or no time was open when they looked. Nobody else
   * would notice them, so they are listed for the office to enrol or chase.
   */
  const offerOfCourse = new Map(offers.map((o) => [o.courseId, o.id]));
  const [enrolled, seats] = offers.length
    ? await Promise.all([
        db.enrollment.findMany({
          where: { organizationId, status: { in: ['ENROLLED', 'REGISTERED'] }, product: { course: { id: { in: offers.map((o) => o.courseId) } } } },
          orderBy: { createdAt: 'asc' },
          take: 1000,
          select: { id: true, userId: true, createdAt: true, product: { select: { title: true, course: { select: { id: true } } } }, user: { select: { name: true, email: true, phone: true } } },
        }),
        db.tutoringSeat.findMany({ where: { organizationId, status: { in: ['WAITING', 'PLACED', 'COMPLETED'] } }, select: { userId: true, offerId: true, enrollmentId: true, status: true } }),
      ])
    : [[], []];
  const openSeat = new Set(seats.filter((s) => s.status !== 'COMPLETED').map((s) => `${s.userId}:${s.offerId}`));
  const noTime = freeEnrolments(enrolled, seats)
    .filter((e) => !openSeat.has(`${e.userId}:${offerOfCourse.get(e.product.course?.id ?? '') ?? ''}`))
    .slice(0, 200);
  const offerList = offers.map((o) => ({ id: o.id, title: titleOf.get(o.courseId) ?? 'Course', tutors: o.tutors.map((t) => ({ id: t.userId, name: who.get(t.userId)?.name ?? 'Tutor' })) }));
  const offerOf = new Map(offerList.map((o) => [o.id, o]));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-8">
        <Section title="Waiting for a tutor">
          {waiting.length === 0 ? (
            <EmptyState title="Nobody is waiting" hint="A learner waits here only when no tutor is free at the time they asked for. They are placed by themselves the moment one is." />
          ) : (
            <Table head={['Learner', 'Asked for', '']}>
              {waiting.map((w) => (
                <Row key={w.id}>
                  <Cell>
                    <span className="font-medium">{who.get(w.userId)?.name ?? 'Learner'}</span>
                    <p className="t-small faint">{who.get(w.userId)?.email ?? who.get(w.userId)?.phone}</p>
                  </Cell>
                  <Cell>
                    {offerOf.get(w.offerId)?.title ?? 'Course'}
                    <p className="t-small faint">
                      {timeLabel(w.preferredMinute)}, from {formatDayLabel(w.preferredFrom, tenant.timezone)}
                    </p>
                    {w.note && <p className="t-small faint">{w.note}</p>}
                  </Cell>
                  <Cell>{mayEdit && <WaitingActions seatId={w.id} time={timeField(w.preferredMinute)} tutors={offerOf.get(w.offerId)?.tutors ?? []} />}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Section>
        <Section title="Enrolled, no class time yet">
          {noTime.length === 0 ? (
            <EmptyState title="Everyone has a class time" hint="A learner on a course taught with an online tutor shows here until they choose a time, or you enrol them with a tutor." />
          ) : (
            <Table head={['Learner', 'Course', 'Enrolled']}>
              {noTime.map((e) => (
                <Row key={e.id}>
                  <Cell>
                    <span className="font-medium">{e.user.name}</span>
                    <p className="t-small faint">{e.user.email ?? e.user.phone}</p>
                  </Cell>
                  <Cell>{e.product.title}</Cell>
                  <Cell>{formatDayLabel(dayKey(e.createdAt, tenant.timezone), tenant.timezone)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Section>
      </div>
      {mayEdit && (
        <Section title="Enrol a learner with an online tutor">
          <Card>
            <EnrolTutoringForm offers={offerList} today={todayKey(tenant.timezone)} />
            <p className="t-small faint mt-4">
              A learner who bought the course can also choose their own time, under Online tutor in their portal. Either way the tutor is found by the hours tutors have marked.
            </p>
          </Card>
        </Section>
      )}
    </div>
  );
}
