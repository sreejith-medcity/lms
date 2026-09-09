import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { questionsOf, FORM_TYPE_LABELS } from '@/lib/feedback';
import { addDays, dayKey, formatDayLabel, todayKey } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ColumnChart } from '@/components/chart';
import { Breakdown, Definitions } from '@/components/analytics-bits';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const WINDOW_DAYS = 30;

/**
 * What the room said.
 *
 * Two numbers matter and both are easy to fake: the average, which flatters
 * itself when only the happy answer, and the response rate, which is the only
 * thing that says whether the average means anything. So the rate is printed
 * beside it, with its denominator spelled out underneath.
 */
export default async function FeedbackResults({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('feedback_form.view_responses', 'view');
  const tz = tenant.timezone;

  const form = await db.feedbackForm.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      name: true,
      type: true,
      isActive: true,
      questions: true,
      createdAt: true,
      responses: {
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          userId: true,
          rating: true,
          answers: true,
          createdAt: true,
          sessionId: true,
          session: { select: { title: true, startsAt: true } },
        },
      },
    },
  });
  if (!form) notFound();

  const questions = questionsOf(form.questions);
  const responses = form.responses;
  const respondents = new Set(responses.map((r) => r.userId).filter(Boolean)).size;

  // Who could have answered: for a class form, everyone who sat a class that has
  // finished since the form was written. Anything else is judged against the
  // people enrolled in a running batch.
  const audience =
    form.type === 'SESSION'
      ? (
          await db.attendance.findMany({
            where: {
              status: { in: ['PRESENT', 'LATE'] },
              session: {
                organizationId: tenant.organizationId,
                startsAt: { gte: form.createdAt, lte: new Date() },
                status: { not: 'CANCELLED' },
              },
            },
            select: { userId: true },
            distinct: ['userId'],
          })
        ).length
      : await db.enrollment.count({
          where: {
            organizationId: tenant.organizationId,
            status: { in: ['ENROLLED', 'REGISTERED'] },
          },
        });

  const rated = responses.map((r) => r.rating).filter((r): r is number => r != null);
  const average = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = rated.filter((r) => Math.round(r) === star).length;
    return {
      label: `${star} star${star === 1 ? '' : 's'}`,
      value: String(count),
      ratio: rated.length ? Math.round((count / rated.length) * 100) : 0,
      sub: rated.length ? `${Math.round((count / rated.length) * 100)}% of ratings` : undefined,
      tone: star >= 4 ? ('ok' as const) : star === 3 ? ('warn' as const) : ('bad' as const),
    };
  });

  // The timeline: one column per day, so a form that was answered on the day it
  // went out and never again looks exactly like what it is.
  const today = todayKey(tz);
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i - (WINDOW_DAYS - 1)));
  const perDay = new Map<string, number>();
  for (const r of responses) {
    const key = dayKey(r.createdAt, tz);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const points = days.map((day) => ({
    label: formatDayLabel(day, tz),
    axisLabel: day.slice(8),
    value: perDay.get(day) ?? 0,
    display: String(perDay.get(day) ?? 0),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/feedback" className="t-small faint hover:underline">
          Feedback
        </Link>
        <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
          {form.name}
          <Badge tone={form.isActive ? 'ok' : 'neutral'}>{form.isActive ? 'open' : 'closed'}</Badge>
        </h1>
        <p className="t-small faint mt-1">
          {FORM_TYPE_LABELS[form.type] ?? form.type} · {questions.length}{' '}
          {questions.length === 1 ? 'question' : 'questions'} · written{' '}
          {formatDayLabel(dayKey(form.createdAt, tz), tz)}
        </p>
      </div>

      <StatGrid>
        <Stat label="Answers" value={responses.length} sub={`${respondents} different people`} />
        <Stat
          label="Response rate"
          value={audience > 0 ? `${Math.round((respondents / audience) * 100)}%` : '—'}
          sub={audience > 0 ? `of ${audience} who could have answered` : 'nobody could answer yet'}
        />
        <Stat
          label="Average rating"
          value={average != null ? average.toFixed(1) : '—'}
          sub={rated.length ? `from ${rated.length} ratings` : 'no ratings given'}
        />
        <Stat
          label="Happy"
          value={rated.length ? `${Math.round((rated.filter((r) => r >= 4).length / rated.length) * 100)}%` : '—'}
          sub="rated four or five"
        />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <h2 className="t-heading">Answers per day</h2>
          <p className="t-small faint mt-1">The last thirty days.</p>
          <div className="mt-4">
            <ColumnChart points={points} emptyMessage="Nobody has answered this form yet." />
          </div>
        </Card>

        <Breakdown
          title="How they rated it"
          rows={distribution}
          empty="No star ratings on this form yet."
        />
      </div>

      {responses.length === 0 ? (
        <EmptyState
          title="No answers yet"
          hint="A class form appears to learners on their dashboard once a class they attended has finished."
        />
      ) : (
        <div className="space-y-3">
          <h2 className="t-heading">What they said</h2>
          <Table head={['When', 'About', 'Rating', 'Answers']}>
            {responses.slice(0, 100).map((r) => {
              const answers = (r.answers ?? {}) as Record<string, string>;
              return (
                <Row key={r.id}>
                  <Cell className="whitespace-nowrap">
                    <span className="t-small">{formatDayLabel(dayKey(r.createdAt, tz), tz)}</span>
                  </Cell>
                  <Cell className="muted">
                    {r.session ? (
                      <Link href={`/admin/sessions/${r.sessionId}`} className="hover:underline">
                        {r.session.title}
                      </Link>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </Cell>
                  <Cell className="tabular-nums">
                    {r.rating != null ? `${r.rating.toFixed(0)} / 5` : '—'}
                  </Cell>
                  <Cell>
                    <ul className="space-y-1">
                      {questions.map((q) =>
                        answers[q.key] ? (
                          <li key={q.key} className="t-small">
                            <span className="faint">{q.label}: </span>
                            {answers[q.key]}
                          </li>
                        ) : null,
                      )}
                    </ul>
                  </Cell>
                </Row>
              );
            })}
          </Table>
          {responses.length > 100 && (
            <p className="t-small faint">Showing the most recent 100 of {responses.length}.</p>
          )}
        </div>
      )}

      <Definitions
        items={[
          [
            'Response rate',
            form.type === 'SESSION'
              ? 'Different people who answered, over the number who sat at least one class that finished after this form was written. Somebody who answered twice counts once.'
              : 'Different people who answered, over the number of learners currently enrolled or registered.',
          ],
          ['Average rating', 'The mean of every star rating given on this form. Answers with no rating are left out.'],
          ['Happy', 'The share of ratings that were four or five stars.'],
          ['Answers per day', 'Responses grouped by the day they arrived, in the academy timezone.'],
        ]}
      />
    </div>
  );
}
