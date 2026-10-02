import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { dayKey, formatDateTime, todayKey } from '@/lib/clock';
import { Badge, Card, Section, Table, Row, Cell } from '@/components/ui';
import { slotLabel, timeField, weekdaysLabel } from '@/lib/tutoring/rules';
import { ReassignForm, SlotForm } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';

export default async function TutoringGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const user = await requireStaff('scheduling.sessions', 'view');
  const mayEdit = can(user.permissions, 'scheduling.sessions', 'edit');
  const group = await db.tutoringGroup.findFirst({ where: { id, organizationId }, include: { offer: { include: { tutors: { select: { userId: true } } } }, seats: true } });
  if (!group) notFound();
  const [course, people, sessions] = await Promise.all([
    db.course.findFirst({ where: { id: group.offer.courseId, organizationId }, select: { product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, id: { in: [group.tutorId, ...group.seats.map((s) => s.userId), ...group.offer.tutors.map((t) => t.userId)] } }, select: { id: true, name: true, email: true, phone: true } }),
    db.liveSession.findMany({ where: { organizationId, batchId: group.batchId }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, status: true, cancelReason: true, registerSubmittedAt: true, instructors: { select: { userId: true } } } }),
  ]);
  const who = new Map(people.map((p) => [p.id, p]));
  const today = todayKey(tenant.timezone);
  const now = new Date();
  const others = group.offer.tutors.filter((t) => t.userId !== group.tutorId).map((t) => ({ id: t.userId, name: who.get(t.userId)?.name ?? 'Tutor' }));

  return (
    <div className="space-y-6">
      <p className="t-small">
        <Link href="/admin/tutoring" className="underline">
          Groups
        </Link>{' '}
        / {course?.product.title}
      </p>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="t-heading">
              {course?.product.title} with {who.get(group.tutorId)?.name ?? 'a tutor'}
            </h2>
            <p className="t-small muted">
              {weekdaysLabel(group.weekdays)}, {slotLabel({ weekdays: group.weekdays, startMinute: group.startMinute, minutes: group.classMinutes })} · {group.classesTotal} classes ·{' '}
              {group.capacity > 1 ? `group of up to ${group.capacity}` : 'one to one'}
            </p>
            <ul className="t-small mt-3 space-y-1">
              {group.seats.map((s) => (
                <li key={s.id}>
                  <Link href={`/admin/learners/${s.userId}`} className="underline">
                    {who.get(s.userId)?.name ?? 'Learner'}
                  </Link>{' '}
                  <span className="faint">{who.get(s.userId)?.email ?? who.get(s.userId)?.phone}</span> {s.status !== 'PLACED' && <Badge>{s.status.toLowerCase()}</Badge>}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-right">
            {group.needsTutor && <Badge tone="bad">needs a tutor</Badge>}
            <p className="mt-2">
              <Link href={`/admin/batches/${group.batchId}`} className="t-small underline">
                Register, attendance and join links
              </Link>
            </p>
          </div>
        </div>
      </Card>

      {mayEdit && group.status === 'ACTIVE' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Move the class time">
            <Card>
              <SlotForm groupId={group.id} time={timeField(group.startMinute)} today={today} />
            </Card>
          </Section>
          <Section title="Hand over to another tutor">
            <Card>{others.length ? <ReassignForm groupId={group.id} tutors={others} today={today} /> : <p className="t-small muted">No other tutor teaches this course. Add one under Courses and tutors.</p>}</Card>
          </Section>
        </div>
      )}

      <Section title="Classes">
        <Table head={['#', 'When', 'Tutor', 'State']}>
          {sessions.map((s, i) => {
            const past = s.startsAt < now;
            return (
              <Row key={s.id}>
                <Cell className="tabular-nums">{i + 1}</Cell>
                <Cell className="tabular-nums">{formatDateTime(s.startsAt, tenant.timezone)}</Cell>
                <Cell>{who.get(s.instructors[0]?.userId ?? '')?.name ?? who.get(group.tutorId)?.name ?? '–'}</Cell>
                <Cell>
                  {s.status === 'CANCELLED' ? (
                    <>
                      <Badge>called off</Badge> <span className="t-small faint">{s.cancelReason}</span>
                    </>
                  ) : s.status === 'COMPLETED' || s.registerSubmittedAt ? (
                    <Badge tone="ok">held</Badge>
                  ) : past ? (
                    <Badge tone="warn">register not in</Badge>
                  ) : dayKey(s.startsAt, tenant.timezone) === today ? (
                    <Badge tone="brand">today</Badge>
                  ) : (
                    <span className="t-small faint">to come</span>
                  )}
                </Cell>
              </Row>
            );
          })}
        </Table>
      </Section>
    </div>
  );
}
