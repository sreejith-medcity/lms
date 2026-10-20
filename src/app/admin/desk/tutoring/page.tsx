import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime, formatDayLabel } from '@/lib/clock';
import { Badge, Card, EmptyState, PageHeader, Section, Table, Row, Cell } from '@/components/ui';
import { tutorTutoringView } from '@/lib/tutoring/tutor';
import { AvailabilityForm, RemoveAvailability, SlotForm, TutorLeaveForm, TutorNoteForm, WithdrawLeave } from '@/components/tutoring/forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Online tutoring', robots: { index: false, follow: false } };

const LEAVE_TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad', WITHDRAWN: 'neutral' } as const;

/**
 * A tutor's own online tutoring: the hours they can teach, their groups,
 * their leave, the progress notes that are due, and the hours they have
 * taught this month. Nothing here needs a permission beyond being staff.
 * The phone app draws the same view from /api/v1/teacher/tutoring.
 */
export default async function MyTutoring() {
  const tenant = await requireTenant();
  const me = await requireStaff();
  const view = await tutorTutoringView(tenant, me.id);
  const { today, groups, month } = view;
  const windows = view.hours;
  const notes = view.notesDue;
  const leaves = view.leave;

  return (
    <div className="space-y-8">
      <PageHeader title="Online tutoring" description="Mark the hours you can teach online, and learners are placed with you inside them. Your groups, your leave and your progress notes are here." />
      <p className="t-small">
        <Link href="/admin/desk" className="underline">
          My teaching
        </Link>{' '}
        / Online tutoring
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          <Section title="My groups">
            {groups.length === 0 ? (
              <EmptyState title="No online learners yet" hint="Once you have marked your hours and the office has put you on a course, learners are placed with you by themselves." />
            ) : (
              <div className="space-y-4">
                {groups.map((g) => {
                  return (
                    <Card key={g.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{g.course}</p>
                          <p className="t-small muted">
                            {g.days}, {g.time}
                          </p>
                          <p className="t-small mt-1">{g.learners.join(', ') || 'No learner yet'}</p>
                          {g.nextClassAt && <p className="t-small faint mt-1">Next class {formatDateTime(g.nextClassAt, tenant.timezone)}</p>}
                        </div>
                        <Link href={`/admin/batches/${g.batchId}`} className="t-small underline">
                          Register and join link
                        </Link>
                      </div>
                      <details className="mt-3">
                        <summary className="t-small cursor-pointer underline">I am not free at this time: move the class</summary>
                        <div className="mt-3">
                          <SlotForm groupId={g.id} time={g.startTime} today={today} />
                        </div>
                      </details>
                    </Card>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Progress notes due">
            {notes.length === 0 ? (
              <p className="t-small muted">None due. A note is asked for after a learner&apos;s 5th, 10th and 15th class and at the end.</p>
            ) : (
              <div className="space-y-4">
                {notes.map((n) => (
                  <Card key={n.id}>
                    <p className="font-medium">
                      {n.learner} <span className="t-small faint">{n.when}</span>
                    </p>
                    <div className="mt-3">
                      <TutorNoteForm feedbackId={n.id} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-8">
          <Section title={`Hours taught, ${month.label}`}>
            <Card>
              <p className="text-2xl font-semibold tabular-nums">{month.hoursLabel}</p>
              <p className="t-small muted">{month.classes} online classes held</p>
              {month.unconfirmed > 0 && (
                <p className="t-small mt-2 text-[var(--warn)]">
                  {month.unconfirmed} {month.unconfirmed === 1 ? 'class has' : 'classes have'} passed with no register. Submit the register and they count.
                </p>
              )}
            </Card>
          </Section>

          <Section title="Hours I can teach online">
            <Card>
              {windows.length === 0 ? (
                <p className="t-small text-[var(--warn)]">You have marked no hours, so no learner can be placed with you.</p>
              ) : (
                <ul className="t-small space-y-1">
                  {windows.map((w) => (
                    <li key={w.id} className="flex justify-between gap-3">
                      <span>{w.label}</span>
                      <RemoveAvailability id={w.id} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t pt-4">
                <AvailabilityForm />
              </div>
              <p className="t-small faint mt-3">Removing hours does not move a group you already have: use &quot;move the class&quot; on the group, or ask for leave.</p>
            </Card>
          </Section>

          <Section title="Leave">
            <Card>
              <TutorLeaveForm today={today} />
            </Card>
            {leaves.length > 0 && (
              <Table head={['Days', 'State', '']}>
                {leaves.map((l) => (
                  <Row key={l.id}>
                    <Cell className="t-small">{l.fromDay === l.toDay ? formatDayLabel(l.fromDay, tenant.timezone, true) : `${formatDayLabel(l.fromDay, tenant.timezone)} to ${formatDayLabel(l.toDay, tenant.timezone)}`}</Cell>
                    <Cell>
                      <Badge tone={LEAVE_TONE[l.status as keyof typeof LEAVE_TONE] ?? 'neutral'}>{l.statusLabel}</Badge>
                    </Cell>
                    <Cell className="text-right">{l.canWithdraw && <WithdrawLeave leaveId={l.id} />}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
