import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { childOf, requireParentSession } from '@/lib/parent-session';
import { courseProgress } from '@/lib/progress-data';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { Badge, Card, ProgressBar } from '@/components/ui';

import { AccessRemoved } from '../../access-removed';
import { ChildTabs } from '../../child-tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress', robots: { index: false, follow: false } };

const STATUS_TONE = { PRESENT: 'ok', LATE: 'warn', ABSENT: 'bad', EXCUSED: 'neutral' } as const;

/**
 * The parent's progress view, one course at a time. Beside every figure:
 * the period, the last update and what was counted. Where there is not
 * enough to say, it says so rather than showing a zero.
 */
export default async function ProgressPage({ params, searchParams }: { params: Promise<{ childId: string }>; searchParams: Promise<{ course?: string }> }) {
  const { childId } = await params;
  const { course } = await searchParams;
  const tenant = await requireTenant();
  const session = await requireParentSession();
  const child = await childOf(tenant.organizationId, session.contact, childId);
  if (!child) return <AccessRemoved />;
  const tz = tenant.timezone;

  const enrolments = await db.enrollment.findMany({
    where: { organizationId: tenant.organizationId, userId: child.id, status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, status: true, product: { select: { title: true } }, batch: { select: { name: true, level: true } } },
  });
  const chosen = enrolments.find((e) => e.id === course) ?? enrolments[0] ?? null;
  const p = chosen ? await courseProgress(tenant.organizationId, child.id, chosen.id) : null;
  const day = (d: Date) => formatDayLabel(dayKey(d, tz), tz);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-5 py-7">
      <ChildTabs child={child} current="academics" />
      <div>
        {enrolments.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {enrolments.map((e) => (
              <Link
                key={e.id}
                href={`/parent/${child.id}/progress?course=${e.id}`}
                className={`rounded-full border px-3 py-1 text-sm ${e.id === chosen?.id ? 'border-[var(--brand)] text-[var(--brand)]' : ''}`}
              >
                {e.product.title}
                {e.batch?.level ? ` · ${e.batch.level}` : ''}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!p ? (
        <Card>
          <p className="t-small muted">No course to show progress for yet.</p>
        </Card>
      ) : (
        <>
          <p className="t-small faint">
            {p.enrolment.course}
            {p.enrolment.batch ? ` · ${p.enrolment.batch}` : ''}
            {p.enrolment.level ? ` · ${p.enrolment.level}` : ''} · period {day(p.period.from)} to {day(p.period.to)}
            {p.lastUpdate ? ` · last update ${day(p.lastUpdate)}` : ''}
          </p>

          <Card>
            <h2 className="t-heading">Overall rating</h2>
            {p.rating ? (
              <>
                <p className="mt-2 text-2xl font-semibold">
                  {p.rating.label} <span className="t-small faint">({p.rating.percent}%)</span>
                </p>
                <p className="t-micro faint mt-1">Basis: {p.rating.basis}</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-lg font-medium">Not yet assessed</p>
                <p className="t-micro faint mt-1">{p.rubricSet ? 'Not enough data in this period to rate.' : 'The academy has not approved a rating rubric for this program, so no overall figure is shown.'}</p>
              </>
            )}
          </Card>

          <Card>
            <h2 className="t-heading">Attendance</h2>
            {p.attendance.percent === null ? (
              <p className="t-small muted mt-2">No completed classes with a final record in this period.</p>
            ) : (
              <>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{p.attendance.percent}%</p>
                <ProgressBar value={p.attendance.percent} />
                <p className="t-small mt-2 tabular-nums">
                  {p.attendance.present} present · {p.attendance.late} late · {p.attendance.absent} absent
                  {p.attendance.excused ? ` · ${p.attendance.excused} excused` : ''}
                  {p.attendance.notRecorded ? ` · ${p.attendance.notRecorded} not recorded` : ''}
                </p>
              </>
            )}
            <p className="t-micro faint mt-1">Basis: {p.attendance.basis}</p>
            {p.classes.length > 0 && (
              <details className="mt-3">
                <summary className="t-small cursor-pointer">Class by class</summary>
                <ul className="mt-2 divide-y">
                  {p.classes.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {c.title} <span className="faint">· {day(c.startsAt)} {formatTime(c.startsAt, tz)}</span>
                      </span>
                      {c.status ? (
                        <Badge tone={STATUS_TONE[c.status]}>
                          {c.status.toLowerCase()}
                          {c.corrected ? ' (corrected)' : ''}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">not recorded</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card>
            <h2 className="t-heading">Test scores</h2>
            {p.trends.length === 0 ? (
              <p className="t-small muted mt-2">No results published in this period.</p>
            ) : (
              <div className="mt-2 space-y-4">
                {p.trends.map((t) => (
                  <div key={t.label}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{t.label}</p>
                      <p className="t-small tabular-nums">average {t.average}%</p>
                    </div>
                    <ol className="mt-1 flex flex-wrap gap-2">
                      {t.points.map((pt, i) => (
                        <li key={i} className="rounded-[var(--radius-sm)] border px-2 py-1 text-sm tabular-nums" title={pt.title}>
                          {pt.percent}%{pt.grade ? ` ${pt.grade}` : ''}
                          <span className="t-micro faint block">{day(pt.date)}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="t-micro faint mt-1">Basis: {t.basis}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="t-micro faint mt-2">
              Only results the branch has published are shown. Different kinds of test and skills are kept apart rather than averaged together.
            </p>
          </Card>

          <Card>
            <h2 className="t-heading">Homework</h2>
            {p.homework.due === 0 ? (
              <p className="t-small muted mt-2">No homework due in this period.</p>
            ) : (
              <>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {p.homework.complete} of {p.homework.due}
                </p>
                <p className="t-small mt-1 tabular-nums">
                  verified complete
                  {p.homework.awaiting ? ` · ${p.homework.awaiting} awaiting verification` : ''}
                  {p.homework.incomplete ? ` · ${p.homework.incomplete} incomplete` : ''}
                  {p.homework.resubmit ? ` · ${p.homework.resubmit} to hand in again` : ''}
                  {p.homework.notSubmitted ? ` · ${p.homework.notSubmitted} not submitted` : ''}
                </p>
                <ul className="mt-3 divide-y">
                  {p.homeworkItems.map((h) => (
                    <li key={h.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {h.title}
                          {h.dueAt ? <span className="faint"> · due {day(h.dueAt)}</span> : null}
                        </span>
                        <Badge tone={!h.handedIn ? 'bad' : h.verification === 'COMPLETE' ? 'ok' : h.verification === 'INCOMPLETE' ? 'warn' : h.verification === 'RESUBMIT' ? 'bad' : 'neutral'}>
                          {!h.handedIn ? 'not submitted' : h.verification === 'COMPLETE' ? 'complete' : h.verification === 'INCOMPLETE' ? 'incomplete' : h.verification === 'RESUBMIT' ? 'hand in again' : 'awaiting verification'}
                        </Badge>
                      </div>
                      {h.feedback && <p className="t-small mt-1">{h.feedback}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="t-micro faint mt-1">Basis: {p.homework.basis}</p>
          </Card>

          <Card>
            <h2 className="t-heading">Teacher remarks</h2>
            {p.remarks.length === 0 ? (
              <p className="t-small muted mt-2">No approved remarks in this period.</p>
            ) : (
              <ul className="mt-2 divide-y">
                {p.remarks.map((r, i) => (
                  <li key={i} className="py-2 text-sm">
                    <p className="t-micro faint">
                      {day(r.on)} · {r.about}
                    </p>
                    <p>{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="t-heading">Level</h2>
            {p.levels.current || p.levels.completed.length ? (
              <p className="mt-2 text-sm">
                {p.levels.current ? (
                  <>
                    Now at <span className="font-medium">{p.levels.current}</span>.{' '}
                  </>
                ) : null}
                {p.levels.completed.length ? `Completed: ${p.levels.completed.join(', ')}. ` : ''}
                {p.levels.remaining.length ? `Remaining: ${p.levels.remaining.join(', ')}.` : ''}
              </p>
            ) : (
              <p className="t-small muted mt-2">{p.enrolment.program ? 'No level recorded yet.' : 'This course is not part of a program with levels.'}</p>
            )}
            <p className="t-micro faint mt-1">Basis: {p.levels.basis}</p>
          </Card>
        </>
      )}
    </div>
  );
}
