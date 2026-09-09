import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDayLabel, dayKey } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { FormBuilder, FormState } from './editors';
import { FORM_TYPE_LABELS, questionsOf } from '@/lib/feedback';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function FeedbackPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('feedback_form.view_responses', 'view');
  const canEdit = me.permissions['feedback_form.manage_forms']?.edit ?? false;
  const tz = tenant.timezone;

  const forms = await db.feedbackForm.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      type: true,
      isActive: true,
      questions: true,
      createdAt: true,
      responses: { select: { rating: true, createdAt: true } },
    },
  });

  const totalResponses = forms.reduce((n, f) => n + f.responses.length, 0);
  const rated = forms.flatMap((f) => f.responses.map((r) => r.rating)).filter((r): r is number => r != null);
  const average = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  const week = new Date();
  week.setDate(week.getDate() - 7);
  const recent = forms.reduce(
    (n, f) => n + f.responses.filter((r) => r.createdAt >= week).length,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="Ask the room what it thought, and keep the answers where the people who can act on them will see them."
      />

      <StatGrid>
        <Stat label="Forms" value={forms.length} sub={`${forms.filter((f) => f.isActive).length} taking answers`} />
        <Stat label="Answers" value={totalResponses} sub="all time" />
        <Stat label="This week" value={recent} sub="answers in the last seven days" />
        <Stat
          label="Average rating"
          value={average != null ? average.toFixed(1) : '—'}
          sub={rated.length ? `${rated.length} people gave a star rating` : 'nobody has rated yet'}
        />
      </StatGrid>

      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          hint="Write one below. A class form with a star rating and one open question is usually enough to be useful."
        />
      ) : (
        <Table head={['Form', 'Asks about', 'Questions', 'Answers', 'Average', 'State', '']}>
          {forms.map((f) => {
            const questions = questionsOf(f.questions);
            const ratings = f.responses.map((r) => r.rating).filter((r): r is number => r != null);
            const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
            const last = f.responses.reduce<Date | null>(
              (latest, r) => (!latest || r.createdAt > latest ? r.createdAt : latest),
              null,
            );

            return (
              <Row key={f.id}>
                <Cell>
                  <Link href={`/admin/feedback/${f.id}`} className="font-medium hover:underline">
                    {f.name}
                  </Link>
                  <p className="t-micro faint">
                    {last
                      ? `last answered ${formatDayLabel(dayKey(last, tz), tz)}`
                      : 'no answers yet'}
                  </p>
                </Cell>
                <Cell className="muted">{FORM_TYPE_LABELS[f.type] ?? f.type}</Cell>
                <Cell className="tabular-nums">{questions.length}</Cell>
                <Cell className="tabular-nums">{f.responses.length}</Cell>
                <Cell className="tabular-nums">{avg != null ? avg.toFixed(1) : '—'}</Cell>
                <Cell>
                  {canEdit ? (
                    <FormState id={f.id} isActive={f.isActive} hasResponses={f.responses.length > 0} />
                  ) : (
                    <Badge tone={f.isActive ? 'ok' : 'neutral'}>
                      {f.isActive ? 'open' : 'closed'}
                    </Badge>
                  )}
                </Cell>
                <Cell className="text-right">
                  <Link href={`/admin/feedback/${f.id}`} className="t-small faint hover:underline">
                    Results
                  </Link>
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Write a form</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Short forms get answered. A star rating plus one question people can answer in a
            sentence beats eight questions nobody finishes.
          </p>
          <div className="mt-4">
            <FormBuilder />
          </div>
        </Card>
      )}
    </div>
  );
}
