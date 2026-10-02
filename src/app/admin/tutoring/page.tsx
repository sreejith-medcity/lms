import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatDayLabel, dayKey } from '@/lib/clock';
import { Badge, EmptyState, Table, Row, Cell } from '@/components/ui';
import { slotLabel, weekdaysLabel } from '@/lib/tutoring/rules';

export const dynamic = 'force-dynamic';

export default async function TutoringGroups({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const all = sp.show === 'all';
  const groups = await db.tutoringGroup.findMany({
    where: { organizationId, ...(all ? {} : { status: 'ACTIVE' }) },
    orderBy: [{ needsTutor: 'desc' }, { startMinute: 'asc' }],
    take: 200,
    include: { offer: { select: { courseId: true } }, seats: { where: { status: { in: ['PLACED', 'COMPLETED'] } }, select: { userId: true } } },
  });
  const now = new Date();
  const [courses, people, held, batches] = await Promise.all([
    db.course.findMany({ where: { organizationId, id: { in: groups.map((g) => g.offer.courseId) } }, select: { id: true, product: { select: { title: true } } } }),
    db.user.findMany({ where: { organizationId, id: { in: [...groups.map((g) => g.tutorId), ...groups.flatMap((g) => g.seats.map((s) => s.userId))] } }, select: { id: true, name: true } }),
    groups.length
      ? db.liveSession.groupBy({ by: ['batchId'], where: { organizationId, batchId: { in: groups.map((g) => g.batchId) }, status: { not: 'CANCELLED' }, endsAt: { lt: now } }, _count: { _all: true } })
      : Promise.resolve([]),
    db.batch.findMany({ where: { organizationId, id: { in: groups.map((g) => g.batchId) } }, select: { id: true, endDate: true } }),
  ]);
  const titleOf = new Map(courses.map((c) => [c.id, c.product.title]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const heldOf = new Map(held.map((h) => [h.batchId, h._count._all]));
  const endOf = new Map(batches.map((b) => [b.id, b.endDate]));

  return (
    <div className="space-y-4">
      <p className="t-small">
        <Link href={all ? '/admin/tutoring' : '/admin/tutoring?show=all'} className="underline">
          {all ? 'Show running groups only' : 'Show finished groups too'}
        </Link>
      </p>
      {groups.length === 0 ? (
        <EmptyState title="No groups yet" hint="A group is made the moment a learner is placed with a tutor. Start under Courses and tutors, then enrol a learner under Learners." />
      ) : (
        <Table head={['Course', 'Tutor', 'When', 'Learners', 'Classes', '']}>
          {groups.map((g) => {
            const end = endOf.get(g.batchId);
            return (
              <Row key={g.id}>
                <Cell>
                  <span className="font-medium">{titleOf.get(g.offer.courseId) ?? 'Course'}</span>{' '}
                  {g.status !== 'ACTIVE' && <Badge>{g.status === 'COMPLETED' ? 'finished' : 'closed'}</Badge>}
                  {g.needsTutor && <Badge tone="bad">needs a tutor</Badge>}
                  <p className="t-small faint">{g.capacity > 1 ? `Group of up to ${g.capacity}` : 'One to one'}</p>
                </Cell>
                <Cell>{nameOf.get(g.tutorId) ?? '–'}</Cell>
                <Cell>
                  {slotLabel({ weekdays: g.weekdays, startMinute: g.startMinute, minutes: g.classMinutes })}
                  <p className="t-small faint">{weekdaysLabel(g.weekdays)}</p>
                </Cell>
                <Cell>
                  {g.seats.map((s) => nameOf.get(s.userId) ?? 'Learner').join(', ') || '–'}
                </Cell>
                <Cell className="tabular-nums">
                  {heldOf.get(g.batchId) ?? 0} of {g.classesTotal}
                  <p className="t-small faint">
                    {formatDayLabel(g.startsOn, tenant.timezone)}
                    {end ? ` to ${formatDayLabel(dayKey(end, tenant.timezone), tenant.timezone)}` : ''}
                  </p>
                </Cell>
                <Cell className="text-right">
                  <Link href={`/admin/tutoring/groups/${g.id}`} className="t-small underline">
                    Open
                  </Link>
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </div>
  );
}
