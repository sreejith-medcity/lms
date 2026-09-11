import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { happened } from '@/lib/events';
import { balanceOf, reminderDue } from '@/lib/dues';
import { formatMoney } from '@/lib/money';

/**
 * Fee reminders, sent by the clock.
 *
 * Four touches per instalment: three days before, the day after it lapses,
 * a week after and a fortnight after. Each carries its own dedupe key, so a
 * cron that runs every few minutes queues each one once; and only the latest
 * stage that applies is sent, so an instalment that somehow went unreminded
 * for twenty days gets one message, not four.
 *
 * The scan is bounded to instalments due within the next three days or
 * already lapsed, on enrolments that are still live: chasing somebody whose
 * enrolment was cancelled is a complaint waiting to happen.
 */

export interface FeeReminderResult {
  considered: number;
  queued: number;
}

export async function queueFeeReminders(organizationId: string): Promise<FeeReminderResult> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * 864e5);

  const rows = await db.instalment.findMany({
    where: {
      paidAt: null,
      dueDate: { lte: horizon },
      enrollment: { organizationId, status: { in: ['ENROLLED', 'REGISTERED'] } },
    },
    select: {
      id: true,
      sequence: true,
      amountPaise: true,
      paidPaise: true,
      dueDate: true,
      enrollment: {
        select: {
          productId: true,
          product: { select: { title: true } },
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
    take: 500,
  });

  if (!rows.length) return { considered: 0, queued: 0 };

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, currency: true },
  });
  const currency = organization?.currency ?? 'INR';

  let queued = 0;

  for (const row of rows) {
    const due = reminderDue(row, now);
    if (!due) continue;

    const learner = row.enrollment.user;
    const result = await queueNotifications({
      organizationId,
      eventKey: 'instalment.due',
      recipients: [{ userId: learner.id, email: learner.email, phone: learner.phone }],
      dedupeKey: due.dedupeKey,
      context: {
        name: learner.name,
        amount: formatMoney(balanceOf(row), currency),
        item: row.enrollment.product.title,
        date: row.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        stage: due.tone,
        payUrl: '/learn/fees',
        organization: organization?.name ?? '',
      },
    });

    if (result.queued > 0) {
      queued += result.queued;
      await db.instalment.update({ where: { id: row.id }, data: { reminderSentAt: now } });

      // The first reminder after the due date is the moment it becomes
      // overdue, and the moment an automation may want to act.
      if (due.stage === 'ON_DAY' || due.stage === 'WEEK') {
        await happened({
          organizationId,
          key: 'instalment.overdue',
          userId: learner.id,
          subjectId: `${row.id}:${due.stage}`,
          productId: row.enrollment.productId,
          data: { instalmentId: row.id, sequence: row.sequence, amountPaise: balanceOf(row), item: row.enrollment.product.title, dueDate: row.dueDate.toISOString(), stage: due.stage },
        });
      }
    }
  }

  return { considered: rows.length, queued };
}
