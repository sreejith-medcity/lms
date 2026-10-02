import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatDayLabel, dayKey } from '@/lib/clock';
import { Badge, EmptyState, Section, Table, Row, Cell } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { LOW_RATING, milestoneLabel } from '@/lib/tutoring/rules';

export const dynamic = 'force-dynamic';

/**
 * What learners say about their tutors and what tutors write about their
 * learners, asked for after classes 5, 10 and 15 and at the end. Low
 * ratings come first: they are the ones to ring about.
 */
export default async function TutoringFeedbackPage() {
  const tenant = await requireTenant();
  const organizationId = tenant.organizationId;
  const [submitted, waitingLearner, waitingTutor] = await Promise.all([
    db.tutoringFeedback.findMany({ where: { organizationId, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, take: 200 }),
    db.tutoringFeedback.count({ where: { organizationId, submittedAt: null, direction: 'LEARNER' } }),
    db.tutoringFeedback.count({ where: { organizationId, submittedAt: null, direction: 'TUTOR' } }),
  ]);
  const people = await db.user.findMany({ where: { organizationId, id: { in: [...submitted.map((f) => f.learnerId), ...submitted.map((f) => f.tutorId)] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const fromLearners = submitted.filter((f) => f.direction === 'LEARNER');
  const fromTutors = submitted.filter((f) => f.direction === 'TUTOR');
  const low = fromLearners.filter((f) => (f.rating ?? 5) <= LOW_RATING);
  const average = fromLearners.length ? Math.round((fromLearners.reduce((n, f) => n + (f.rating ?? 0), 0) / fromLearners.length) * 10) / 10 : null;
  const when = (d: Date | null) => (d ? formatDayLabel(dayKey(d, tenant.timezone), tenant.timezone) : '');
  const detail = (answers: unknown, labels: Record<string, string>) =>
    Object.entries((answers ?? {}) as Record<string, number | null>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${labels[k] ?? k} ${v}`)
      .join(' · ');

  return (
    <div className="space-y-8">
      <StatGrid>
        <Stat label="Learners' rating of tutors" value={average ? `${average} / 5` : '—'} sub={`${fromLearners.length} responses`} />
        <Stat label="Low ratings" value={String(low.length)} sub={low.length ? 'at the top below' : 'none'} />
        <Stat label="Learners yet to answer" value={String(waitingLearner)} sub="asked, not answered" />
        <Stat label="Progress notes due" value={String(waitingTutor)} sub="from tutors" />
      </StatGrid>

      <Section title="From learners, about their tutor">
        {fromLearners.length === 0 ? (
          <EmptyState title="No feedback yet" hint="A learner is asked after their 5th, 10th and 15th class and at the end of the course." />
        ) : (
          <Table head={['Learner', 'Tutor', 'When', 'Rating', 'What they said']}>
            {[...low, ...fromLearners.filter((f) => !low.includes(f))].map((f) => (
              <Row key={f.id}>
                <Cell className="font-medium">{nameOf.get(f.learnerId) ?? 'Learner'}</Cell>
                <Cell>{nameOf.get(f.tutorId) ?? 'Tutor'}</Cell>
                <Cell className="t-small">
                  {milestoneLabel(f.milestone)}
                  <p className="faint">{when(f.submittedAt)}</p>
                </Cell>
                <Cell>
                  <Badge tone={(f.rating ?? 5) <= LOW_RATING ? 'bad' : (f.rating ?? 0) >= 4 ? 'ok' : 'warn'}>{f.rating} / 5</Badge>
                </Cell>
                <Cell className="t-small">
                  {f.comment || <span className="faint">No comment</span>}
                  <p className="faint">{detail(f.answers, { clear: 'Explains clearly', punctual: 'On time', pace: 'Pace' })}</p>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title="From tutors, about their learners">
        {fromTutors.length === 0 ? (
          <p className="t-small muted">No progress notes yet.</p>
        ) : (
          <Table head={['Learner', 'Tutor', 'When', 'Progress', 'Note']}>
            {fromTutors.map((f) => (
              <Row key={f.id}>
                <Cell className="font-medium">{nameOf.get(f.learnerId) ?? 'Learner'}</Cell>
                <Cell>{nameOf.get(f.tutorId) ?? 'Tutor'}</Cell>
                <Cell className="t-small">
                  {milestoneLabel(f.milestone)}
                  <p className="faint">{when(f.submittedAt)}</p>
                </Cell>
                <Cell>
                  <Badge tone={(f.rating ?? 5) <= LOW_RATING ? 'bad' : (f.rating ?? 0) >= 4 ? 'ok' : 'warn'}>{f.rating} / 5</Badge>
                </Cell>
                <Cell className="t-small">
                  {f.comment}
                  <p className="faint">{detail(f.answers, { attendance: 'Attendance', participation: 'Takes part', homework: 'Homework' })}</p>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
