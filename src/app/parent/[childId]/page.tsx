import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { childOf, getParentSession } from '@/lib/parent-session';
import { childDetail } from '@/lib/parent-data';
import { attendanceNote } from '@/lib/parents';
import { balanceOf } from '@/lib/dues';
import { feeStatusLabel } from '@/lib/misc-fees';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatTime } from '@/lib/clock';
import { Badge, Card, Cell, ProgressBar, Row, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Parent view', robots: { index: false, follow: false } };

const STATUS_TONE = { PRESENT: 'ok', LATE: 'warn', ABSENT: 'bad', EXCUSED: 'neutral' } as const;
const STATUS_WORD = { PRESENT: 'present', LATE: 'late', ABSENT: 'absent', EXCUSED: 'excused' } as const;

/**
 * One child, everything the academy would tell a parent who rang: the
 * courses, the classes coming up, attendance class by class, what is owed
 * and what was paid, marks, and the report cards issued.
 */
export default async function ChildPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params;
  const tenant = await requireTenant();
  const session = await getParentSession();
  if (!session) redirect('/parent/login');
  const child = await childOf(tenant.organizationId, session.contact, childId);
  if (!child) notFound();

  const now = new Date();
  const d = await childDetail(tenant.organizationId, child.id, now);
  const day = (at: Date) => at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tenant.timezone });

  const feesOpen = d.enrolments.flatMap((e) => e.instalments.filter((i) => balanceOf(i) > 0).map((i) => ({ ...i, course: e.product.title })));

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Link href="/parent" className="t-small faint hover:underline">Your children</Link>
      <h1 className="mt-1 text-xl font-semibold">{child.name}</h1>
      <p className="t-small faint mt-1">
        {child.registrationNo ? `Registration no. ${child.registrationNo} · ` : ''}
        {d.enrolments.length} {d.enrolments.length === 1 ? 'course' : 'courses'}
      </p>

      <div className="mt-6 space-y-5">
        <Card>
          <h2 className="t-heading">Courses</h2>
          {d.enrolments.length === 0 ? (
            <p className="t-small faint mt-2">Not enrolled in anything yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {d.enrolments.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{e.product.title}</p>
                      <p className="t-small faint">{e.batch?.name ?? 'No batch yet'} · {e.branch.name} · joined {day(e.createdAt)}</p>
                    </div>
                    <Badge tone={e.status === 'COMPLETED' ? 'ok' : e.status === 'ENROLLED' ? 'brand' : 'neutral'}>{e.status.toLowerCase().replace('_', ' ')}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1"><ProgressBar value={e.progressPercent} /></div>
                    <span className="t-small tabular-nums muted">{Math.round(e.progressPercent)}% of the course done</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="t-heading">This week's classes</h2>
          {d.upcoming.length === 0 ? (
            <p className="t-small faint mt-2">Nothing scheduled in the next seven days.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {d.upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="t-small faint">{s.batch?.name ?? 'One-to-one'}</p>
                  </div>
                  <span className="t-small tabular-nums">{formatDateTime(s.startsAt, tenant.timezone)} to {formatTime(s.endsAt, tenant.timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="t-heading">Attendance, last 90 days</h2>
            <span className="t-small muted">{attendanceNote(d.attendanceSummary)}</span>
          </div>
          {d.attendance.length === 0 ? (
            <p className="t-small faint mt-2">No classes held yet.</p>
          ) : (
            <>
              <p className="t-small faint mt-1">
                {d.attendanceSummary.present + d.attendanceSummary.late} of {d.attendanceSummary.held} classes attended
                {d.attendanceSummary.excused > 0 ? `, ${d.attendanceSummary.excused} excused` : ''}.
              </p>
              <div className="mt-3">
                <Table head={['Class', 'When', 'Was there']}>
                  {d.attendance.map((a) => (
                    <Row key={a.session.id}>
                      <Cell>
                        <span className="text-sm">{a.session.title}</span>
                        {a.session.batch && <span className="t-small faint block">{a.session.batch.name}</span>}
                      </Cell>
                      <Cell className="tabular-nums">{formatDateTime(a.session.startsAt, tenant.timezone)}</Cell>
                      <Cell>
                        <Badge tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{STATUS_WORD[a.status as keyof typeof STATUS_WORD] ?? a.status.toLowerCase()}</Badge>
                        {a.minutesPresent > 0 && <span className="t-small faint ml-2">{a.minutesPresent} min</span>}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="t-heading">Fees</h2>
          {feesOpen.length === 0 && d.charges.filter((c) => c.status === 'PENDING').length === 0 ? (
            <p className="t-small faint mt-2">Nothing is owed at the moment.</p>
          ) : (
            <div className="mt-3">
              <Table head={['What', 'Due', 'Amount', '']}>
                {feesOpen.map((i) => {
                  const late = i.dueDate.getTime() < now.getTime();
                  return (
                    <Row key={i.id}>
                      <Cell>{i.course} <span className="t-small faint">instalment {i.sequence}</span></Cell>
                      <Cell className="tabular-nums">{day(i.dueDate)}</Cell>
                      <Cell className="tabular-nums">{formatMoney(balanceOf(i), tenant.currency)}</Cell>
                      <Cell>{late ? <Badge tone="bad">overdue</Badge> : <Badge tone="neutral">to come</Badge>}</Cell>
                    </Row>
                  );
                })}
                {d.charges.filter((c) => c.status === 'PENDING').map((c) => {
                  const s = feeStatusLabel(c, now);
                  return (
                    <Row key={c.id}>
                      <Cell>{c.label} <span className="t-small faint">{c.enrollment.product.title}</span></Cell>
                      <Cell className="tabular-nums">{c.dueDate ? day(c.dueDate) : '—'}</Cell>
                      <Cell className="tabular-nums">{formatMoney(c.amountPaise, tenant.currency)}</Cell>
                      <Cell><Badge tone={s.tone}>{s.text}</Badge></Cell>
                    </Row>
                  );
                })}
              </Table>
              <p className="t-small faint mt-3">Fees are paid by the learner from their own sign-in, or at the academy counter.</p>
            </div>
          )}
          {d.receipts.length > 0 && (
            <div className="mt-4">
              <h3 className="t-small font-medium">Paid</h3>
              <ul className="mt-2 divide-y">
                {d.receipts.map((r) => {
                  const raw = (r.raw ?? {}) as { item?: string };
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="t-small">{raw.item ?? 'Fee'}{r.method ? ` · ${r.method}` : ''} · {day(r.capturedAt ?? r.createdAt)} · receipt {r.receiptNo}</span>
                      <span className="tabular-nums">{formatMoney(r.amountPaise, tenant.currency)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="t-heading">
              Tests{' '}
              <Link href={`/parent/${child.id}/progress`} className="t-small font-normal underline">
                progress view →
              </Link>
            </h2>
            {d.marksSummary.marked > 0 && (
              <span className="t-small muted">Average {d.marksSummary.average}% over {d.marksSummary.marked} marked, {d.marksSummary.passed} passed</span>
            )}
          </div>
          {d.marks.length === 0 ? (
            <p className="t-small faint mt-2">No results published yet. A result appears here once the branch has approved it.</p>
          ) : (
            <div className="mt-3">
              <Table head={['Test', 'Date', 'Marks', 'Result']}>
                {d.marks.map((m) => (
                  <Row key={m.id}>
                    <Cell>
                      {m.title}
                      <p className="t-micro faint">
                        {m.category}
                        {m.skill ? ` · ${m.skill}` : ''}
                        {m.level ? ` · ${m.level}` : ''}
                        {m.corrected ? ' · corrected' : ''}
                      </p>
                      {m.remark && <p className="t-small mt-1">{m.remark}</p>}
                      {m.files.length > 0 && (
                        <p className="t-micro mt-1">
                          {m.files.map((f, i) => (
                            <a key={f} href={`/api/assets/${f}`} target="_blank" rel="noreferrer" className="underline">
                              file {i + 1}
                            </a>
                          ))}
                        </p>
                      )}
                    </Cell>
                    <Cell className="tabular-nums">{day(m.submittedAt)}</Cell>
                    <Cell className="tabular-nums">
                      {m.marked && m.marks !== null ? (
                        <>
                          {m.marks} / {m.maxMarks}
                          <p className="t-micro faint">
                            {m.scorePercent}%{m.grade ? ` · ${m.grade}` : ''}
                          </p>
                        </>
                      ) : (
                        <span className="faint">{m.outcome === 'ABSENT' ? 'absent' : 'not assessed'}</span>
                      )}
                    </Cell>
                    <Cell>
                      {!m.marked ? <Badge tone="neutral">{m.outcome === 'ABSENT' ? 'absent' : 'not assessed'}</Badge> : m.passed === true ? <Badge tone="ok">passed</Badge> : m.passed === false ? <Badge tone="bad">{m.passPercent !== null ? `below ${m.passPercent}%` : 'did not pass'}</Badge> : <Badge tone="neutral">scored</Badge>}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="t-heading">Report cards</h2>
          {d.reportCards.length === 0 ? (
            <p className="t-small faint mt-2">None issued yet. The academy sends one at the end of a term or a course.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {d.reportCards.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="t-small faint">
                      {r.enrollment.product.title} · issued {day(r.issuedAt)}
                      {r.periodFrom && r.periodTo ? ` · ${day(r.periodFrom)} to ${day(r.periodTo)}` : ''}
                    </p>
                    {r.remark && <p className="t-small mt-1">{r.remark}</p>}
                  </div>
                  <a href={`/api/report-cards/${r.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                    Open PDF
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
