import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatTime, dayKey } from '@/lib/clock';
import { PAYOUT_STATUS_LABEL, hoursLabel, monthWindow } from '@/lib/payouts';
import { myDesk } from '@/lib/teaching-data';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TONE = { DRAFT: 'neutral', APPROVED: 'brand', PAID: 'ok' } as const;

/**
 * The trainer's desk: their batches, the classes coming up with the host
 * link, what is waiting to be marked, hours taught this month, and what
 * they have been paid. Nothing here needs a permission beyond being staff;
 * it shows only what is theirs.
 */
export default async function DeskPage() {
  const tenant = await requireTenant();
  const me = await requireStaff();
  const now = new Date();
  const monthKey = dayKey(now, tenant.timezone).slice(0, 7);
  const month = monthWindow(monthKey, tenant.timezone)!;
  const d = await myDesk(tenant.organizationId, me.id, now, month.from, month.to);
  const label = (from: Date) => monthWindow(dayKey(new Date(from.getTime() + 36e5 * 36), tenant.timezone).slice(0, 7), tenant.timezone)?.label ?? '';

  const waiting = d.toMark + d.homeworkToMark + d.questionsWaiting;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My teaching"
        description={`${d.batches.length} ${d.batches.length === 1 ? 'batch' : 'batches'}, ${d.monthClasses} ${d.monthClasses === 1 ? 'class' : 'classes'} taken in ${month.label}.`}
      />

      <StatGrid>
        <Stat label={`Hours taught, ${month.label}`} value={hoursLabel(d.monthMinutes)} sub={`${d.monthClasses} classes`} />
        <Stat label="Waiting on you" value={String(waiting)} sub={waiting === 0 ? 'nothing to mark' : `${d.toMark} papers, ${d.homeworkToMark} homework, ${d.questionsWaiting} questions`} />
        <Stat label="This week" value={String(d.upcoming.length)} sub={d.oneToOne > 0 ? `${d.oneToOne} one-to-one` : 'classes scheduled'} />
        <Stat label="Learner rating" value={d.rating ? `${d.rating.average} / 5` : '—'} sub={d.rating ? `from ${d.rating.count} responses` : 'no feedback yet'} />
      </StatGrid>

      {d.batches.length === 0 && d.upcoming.length === 0 ? (
        <EmptyState title="Nothing assigned to you yet" hint="The office puts trainers on batches from the batch page; classes then appear here." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            <Card>
              <h2 className="t-heading">Coming up</h2>
              {d.upcoming.length === 0 ? (
                <p className="t-small faint mt-2">No classes in the next seven days.</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {d.upcoming.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">{s.title}{s.status === 'LIVE' && <Badge tone="ok"> live now</Badge>}</p>
                        <p className="t-small faint">{s.learnerId ? 'One-to-one' : s.batch?.name ?? ''} · {formatDateTime(s.startsAt, tenant.timezone)} to {formatTime(s.endsAt, tenant.timezone)}</p>
                      </div>
                      <div className="flex gap-2">
                        {(s.hostUrl || s.joinUrl) && (
                          <a href={s.hostUrl ?? s.joinUrl ?? '#'} target="_blank" rel="noreferrer" className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
                            Start
                          </a>
                        )}
                        <Link href={`/admin/sessions/${s.id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
                          Open
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="t-heading">My batches</h2>
              {d.batches.length === 0 ? (
                <p className="t-small faint mt-2">None.</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {d.batches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div>
                        <Link href={`/admin/batches/${b.id}`} className="text-sm font-medium hover:underline">{b.name}</Link>
                        <p className="t-small faint">{b.course.product.title} · {b._count.enrollments} learners · {b.role.toLowerCase().replace('_', ' ')}</p>
                      </div>
                      <Badge tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'UPCOMING' ? 'brand' : 'neutral'}>{b.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <h2 className="t-heading">To mark</h2>
              <ul className="mt-3 space-y-2">
                <li className="flex items-center justify-between gap-2 text-sm">
                  <Link href="/admin/submissions" className="hover:underline">Test papers</Link>
                  <span className="tabular-nums font-medium">{d.toMark}</span>
                </li>
                <li className="flex items-center justify-between gap-2 text-sm">
                  <Link href="/admin/assignments" className="hover:underline">Homework</Link>
                  <span className="tabular-nums font-medium">{d.homeworkToMark}</span>
                </li>
                <li className="flex items-center justify-between gap-2 text-sm">
                  <Link href="/admin/questions" className="hover:underline">Questions on lessons</Link>
                  <span className="tabular-nums font-medium">{d.questionsWaiting}</span>
                </li>
              </ul>
            </Card>

            <Card>
              <h2 className="t-heading">Payouts</h2>
              {d.payouts.length === 0 ? (
                <p className="t-small faint mt-2">
                  {d.profile?.hourlyRatePaise || d.profile?.perSessionPaise
                    ? 'Nothing drawn up yet. The office draws up each month from the classes you took.'
                    : 'No rate on your profile yet; the office sets it under Instructors.'}
                </p>
              ) : (
                <ul className="mt-3 divide-y">
                  {d.payouts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <p className="text-sm font-medium">{label(p.periodFrom)}</p>
                        <p className="t-small faint">{p.sessions} classes · {hoursLabel(p.minutes)}</p>
                      </div>
                      <div className="text-right">
                        <p className="tabular-nums font-medium">{formatMoney(p.totalPaise, tenant.currency)}</p>
                        <Badge tone={TONE[p.status as keyof typeof TONE] ?? 'neutral'}>{PAYOUT_STATUS_LABEL[p.status] ?? p.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
