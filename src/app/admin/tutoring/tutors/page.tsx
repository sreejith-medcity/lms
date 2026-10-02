import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { WEEKDAY_LABELS } from '@/lib/clock';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { timeLabel, weekdaysLabel } from '@/lib/tutoring/rules';
import { AvailabilityForm, EmployeeCode, OfferForm, RemoveAvailability } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';

export default async function TutoringTutors() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const user = await requireStaff('scheduling.sessions', 'view');
  const mayEdit = can(user.permissions, 'scheduling.sessions', 'edit');
  const [offers, courses, staff] = await Promise.all([
    db.tutoringOffer.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' }, include: { tutors: { select: { userId: true } } } }),
    db.course.findMany({ where: { organizationId, product: { deletedAt: null } }, orderBy: { product: { title: 'asc' } }, select: { id: true, product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, kind: 'STAFF', status: 'ACTIVE', deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, instructorProfile: { select: { employeeCode: true } } } }),
  ]);
  const tutorIds = [...new Set(offers.flatMap((o) => o.tutors.map((t) => t.userId)))];
  const [windows, groups] = await Promise.all([
    db.tutorAvailability.findMany({ where: { organizationId, userId: { in: tutorIds } }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
    db.tutoringGroup.groupBy({ by: ['tutorId'], where: { organizationId, status: 'ACTIVE' }, _count: { _all: true } }),
  ]);
  const titleOf = new Map(courses.map((c) => [c.id, c.product.title]));
  const loadOf = new Map(groups.map((g) => [g.tutorId, g._count._all]));
  const offered = new Set(offers.map((o) => o.courseId));
  const staffList = staff.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Courses offered with an online tutor">
          {offers.length === 0 ? (
            <EmptyState title="None yet" hint="Choose a course, how it is taught and who teaches it. Learners on that course can then be given a tutor and a class time." />
          ) : (
            <div className="space-y-4">
              {offers.map((o) => (
                <Card key={o.id}>
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium">{titleOf.get(o.courseId) ?? 'Course'}</span> {!o.active && <Badge>closed to new learners</Badge>}
                      <span className="t-small faint block">
                        {o.format === 'GROUP' ? `Groups of up to ${o.groupSize}` : 'One to one'} · {o.classesTotal} classes of {o.classMinutes} minutes · {weekdaysLabel(o.weekdays)} · {o.tutors.length}{' '}
                        {o.tutors.length === 1 ? 'tutor' : 'tutors'}
                      </span>
                    </summary>
                    {mayEdit && (
                      <div className="mt-4">
                        <OfferForm
                          courses={[]}
                          staff={staffList}
                          defaults={{ courseId: o.courseId, format: o.format, groupSize: o.groupSize, classMinutes: o.classMinutes, classesTotal: o.classesTotal, weekdays: o.weekdays, tutors: o.tutors.map((t) => t.userId), active: o.active }}
                        />
                      </div>
                    )}
                  </details>
                </Card>
              ))}
            </div>
          )}
        </Section>
        {mayEdit && (
          <Section title="Offer another course">
            <Card>
              <OfferForm courses={courses.filter((c) => !offered.has(c.id)).map((c) => ({ id: c.id, title: c.product.title }))} staff={staffList} />
            </Card>
          </Section>
        )}
      </div>

      <Section title="Tutors and the hours they have marked">
        {tutorIds.length === 0 ? (
          <p className="t-small muted">Tutors appear here once they are ticked on a course above.</p>
        ) : (
          <Table head={['Tutor', 'Hours they can teach', 'Groups', 'Employee code']}>
            {staff
              .filter((s) => tutorIds.includes(s.id))
              .map((s) => {
                const mine = windows.filter((w) => w.userId === s.id);
                return (
                  <Row key={s.id}>
                    <Cell className="align-top font-medium">{s.name}</Cell>
                    <Cell className="align-top">
                      {mine.length === 0 ? (
                        <span className="t-small text-[var(--warn)]">No hours marked: nobody can be placed with them.</span>
                      ) : (
                        <ul className="t-small space-y-0.5">
                          {mine.map((w) => (
                            <li key={w.id}>
                              {WEEKDAY_LABELS[w.weekday]} {timeLabel(w.startMinute)} to {timeLabel(w.endMinute)} {mayEdit && <RemoveAvailability id={w.id} />}
                            </li>
                          ))}
                        </ul>
                      )}
                      {mayEdit && (
                        <details className="mt-2">
                          <summary className="t-small cursor-pointer underline">Add hours for them</summary>
                          <div className="mt-2 max-w-md">
                            <AvailabilityForm userId={s.id} />
                          </div>
                        </details>
                      )}
                    </Cell>
                    <Cell className="align-top tabular-nums">{loadOf.get(s.id) ?? 0}</Cell>
                    <Cell className="align-top">{mayEdit ? <EmployeeCode userId={s.id} code={s.instructorProfile?.employeeCode ?? ''} /> : (s.instructorProfile?.employeeCode ?? '–')}</Cell>
                  </Row>
                );
              })}
          </Table>
        )}
        <p className="t-small faint">Tutors mark their own hours under My teaching, Online tutoring. The employee code is what the payroll system knows them by.</p>
      </Section>
    </div>
  );
}
