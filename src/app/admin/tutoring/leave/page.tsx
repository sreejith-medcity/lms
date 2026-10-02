import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { formatDayLabel, todayKey } from '@/lib/clock';
import { Badge, Card, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { daysBetween, tutorLeavePlan } from '@/lib/tutoring/rules';
import { LeaveDecision } from '@/components/tutoring/forms';
import type { LeaveOutcome } from '@/lib/tutoring/data';
import { TutorPicker } from './tutor-picker';

export const dynamic = 'force-dynamic';

const TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad', WITHDRAWN: 'neutral' } as const;

export default async function TutoringLeave() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const user = await requireStaff('scheduling.sessions', 'view');
  const mayEdit = can(user.permissions, 'scheduling.sessions', 'edit');
  const [tutorLeaves, learnerLeaves, offers] = await Promise.all([
    db.tutorLeave.findMany({ where: { organizationId }, orderBy: [{ status: 'asc' }, { fromDay: 'desc' }], take: 100 }),
    db.learnerLeave.findMany({ where: { organizationId }, orderBy: { fromDay: 'desc' }, take: 60 }),
    db.tutoringOffer.findMany({ where: { organizationId }, select: { tutors: { select: { userId: true } } } }),
  ]);
  const tutorIds = [...new Set(offers.flatMap((o) => o.tutors.map((t) => t.userId)))];
  const people = await db.user.findMany({ where: { organizationId, id: { in: [...tutorIds, ...tutorLeaves.map((l) => l.userId), ...learnerLeaves.map((l) => l.userId)] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const pending = tutorLeaves.filter((l) => l.status === 'PENDING');
  const rest = tutorLeaves.filter((l) => l.status !== 'PENDING');
  const range = (a: string, b: string) => (a === b ? formatDayLabel(a, tenant.timezone, true) : `${formatDayLabel(a, tenant.timezone)} to ${formatDayLabel(b, tenant.timezone)}`);

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Tutors asking for leave">
          {pending.length === 0 ? (
            <EmptyState title="Nothing to decide" hint="A tutor's request waits here. Approving it rearranges their classes and tells the learners; nothing changes before that." />
          ) : (
            <Table head={['Tutor', 'Days', 'What approving does', '']}>
              {pending.map((l) => {
                const plan = tutorLeavePlan(l.fromDay, l.toDay);
                return (
                  <Row key={l.id}>
                    <Cell className="font-medium">{nameOf.get(l.userId) ?? 'Tutor'}</Cell>
                    <Cell>
                      {range(l.fromDay, l.toDay)}
                      <p className="t-small faint">
                        {daysBetween(l.fromDay, l.toDay)} {daysBetween(l.fromDay, l.toDay) === 1 ? 'day' : 'days'}
                        {l.reason ? ` · ${l.reason}` : ''}
                      </p>
                    </Cell>
                    <Cell className="t-small">{plan === 'REASSIGN' ? 'More than 7 days: each group goes to another tutor free at that time.' : 'Classes on those days are called off and added to the end.'}</Cell>
                    <Cell>{mayEdit && <LeaveDecision leaveId={l.id} />}</Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </Section>
        {mayEdit && (
          <Section title="Enter leave for a tutor">
            <Card>
              <TutorPicker tutors={tutorIds.map((id) => ({ id, name: nameOf.get(id) ?? 'Tutor' }))} today={todayKey(tenant.timezone)} />
            </Card>
          </Section>
        )}
      </div>

      <Section title="Tutor leave, decided">
        {rest.length === 0 ? (
          <p className="t-small muted">None yet.</p>
        ) : (
          <Table head={['Tutor', 'Days', 'State', 'What happened']}>
            {rest.map((l) => {
              const o = l.outcome as unknown as LeaveOutcome | null;
              return (
                <Row key={l.id}>
                  <Cell className="font-medium">{nameOf.get(l.userId) ?? 'Tutor'}</Cell>
                  <Cell>{range(l.fromDay, l.toDay)}</Cell>
                  <Cell>
                    <Badge tone={TONE[l.status as keyof typeof TONE] ?? 'neutral'}>{l.status.toLowerCase()}</Badge>
                  </Cell>
                  <Cell className="t-small">
                    {o
                      ? [
                          o.classesMoved ? `${o.classesMoved} classes moved to the end` : '',
                          o.handedOver?.length ? `${o.handedOver.length} groups handed over` : '',
                          o.needsTutor?.length ? `${o.needsTutor.length} groups need a tutor` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No classes were affected'
                      : '–'}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Section>

      <Section title="Learners on leave">
        {learnerLeaves.length === 0 ? (
          <p className="t-small muted">None yet. A learner takes up to 3 days at a time from their portal, and the tutor is told at once.</p>
        ) : (
          <Table head={['Learner', 'Days', 'Classes moved to the end', 'Reason']}>
            {learnerLeaves.map((l) => (
              <Row key={l.id}>
                <Cell className="font-medium">{nameOf.get(l.userId) ?? 'Learner'}</Cell>
                <Cell>{range(l.fromDay, l.toDay)}</Cell>
                <Cell className="tabular-nums">{l.classesMoved || 'excused (group)'}</Cell>
                <Cell className="t-small">{l.reason || '–'}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
