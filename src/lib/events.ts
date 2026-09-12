import { db } from '@/lib/db';
import { emit } from '@/lib/webhooks';
import { queueNotifications } from '@/lib/notify';

/**
 * One place where things that happened are said out loud.
 *
 * An enrolment, a finished course, a missed class, a paper marked: each of
 * these used to be known only to the code that did it. Now each one is
 * raised here once, and three listeners hear it: the outbound webhooks an
 * academy has subscribed, the automations they have written, and (where the
 * caller asks) the learner's own notification for it.
 *
 * Nothing here may break the action that raised it. A workflow with a bad
 * step or a webhook table that is slow is a problem for the automations
 * screen, not for the learner pressing Enrol; every listener is wrapped.
 */

export interface DomainEventDef {
  key: string;
  label: string;
  group: 'Sales' | 'Account' | 'Learning' | 'Classes' | 'Money';
  /** Which narrowing the automations editor offers for this trigger. */
  filters: ('products' | 'batches' | 'days' | 'outcome')[];
  /** What the learner-facing message for it is called, when there is one. */
  notification?: string;
  /** Raised by a scan on a schedule rather than by an action. */
  scheduled?: boolean;
  /** What the run is about, so a rule fires once per subject rather than once per person. */
  subject: string;
}

export const DOMAIN_EVENTS: DomainEventDef[] = [
  { key: 'lead.created', label: 'An enquiry came in', group: 'Sales', filters: [], subject: 'the enquiry' },
  { key: 'account.created', label: 'Somebody created an account', group: 'Account', filters: [], notification: 'account.welcome', subject: 'the account' },
  { key: 'enrolment.created', label: 'Somebody was enrolled', group: 'Learning', filters: ['products'], notification: 'course.welcome', subject: 'the enrolment' },
  { key: 'course.completed', label: 'Somebody finished a course', group: 'Learning', filters: ['products'], notification: 'course.completed', subject: 'the enrolment' },
  { key: 'certificate.issued', label: 'A certificate was issued', group: 'Learning', filters: ['products'], notification: 'certificate.issued', subject: 'the certificate' },
  { key: 'assessment.marked', label: 'A paper was marked', group: 'Learning', filters: ['outcome'], notification: 'assessment.marked', subject: 'the attempt' },
  { key: 'assignment.set', label: 'Homework was set', group: 'Learning', filters: ['products', 'batches'], notification: 'assignment.set', subject: 'the assignment' },
  { key: 'assignment.handed_in', label: 'Homework was handed in', group: 'Learning', filters: ['products', 'batches'], subject: 'the hand-in' },
  { key: 'assignment.graded', label: 'Homework was marked', group: 'Learning', filters: ['products', 'outcome'], notification: 'assignment.graded', subject: 'the hand-in' },
  { key: 'session.absent', label: 'Somebody missed a class', group: 'Classes', filters: ['batches'], subject: 'the class' },
  { key: 'learner.inactive', label: 'A learner has gone quiet', group: 'Learning', filters: ['days', 'products'], scheduled: true, subject: 'the quiet spell' },
  { key: 'payment.captured', label: 'A payment succeeded', group: 'Money', filters: [], subject: 'the order' },
  { key: 'payment.failed', label: 'A payment failed', group: 'Money', filters: [], notification: 'payment.failed', subject: 'the order' },
  { key: 'cart.abandoned', label: 'Somebody left a cart', group: 'Money', filters: [], subject: 'the cart' },
  { key: 'instalment.overdue', label: 'An instalment went overdue', group: 'Money', filters: [], subject: 'the instalment' },
];

export const DOMAIN_EVENT_KEYS = DOMAIN_EVENTS.map((e) => e.key);
export type DomainEventKey = (typeof DOMAIN_EVENT_KEYS)[number];

export const eventDef = (key: string) => DOMAIN_EVENTS.find((e) => e.key === key) ?? null;

export interface DomainEvent {
  organizationId: string;
  key: string;
  /** The learner it is about, when there is one. */
  userId?: string | null;
  /** The enquiry it is about, for events before there is an account. */
  leadId?: string | null;
  /** The id of the thing this run is about: the enrolment, the class, the order. */
  subjectId: string;
  productId?: string | null;
  batchId?: string | null;
  /** Anything the listeners may want: names, amounts, links. Plain values. */
  data?: Record<string, unknown>;
}

export async function happened(event: DomainEvent): Promise<void> {
  const payload = {
    userId: event.userId ?? null,
    leadId: event.leadId ?? null,
    subjectId: event.subjectId,
    productId: event.productId ?? null,
    batchId: event.batchId ?? null,
    ...(event.data ?? {}),
  };

  try {
    await emit(event.organizationId, event.key, payload);
  } catch (err) {
    console.error(`[events] webhooks for ${event.key}`, err instanceof Error ? err.message : err);
  }

  try {
    const { startWorkflowRuns } = await import('@/lib/workflows');
    await startWorkflowRuns(event);
  } catch (err) {
    console.error(`[events] workflows for ${event.key}`, err instanceof Error ? err.message : err);
  }
}

/**
 * The learner's own message for an event, through the academy's channel
 * settings and templates. Deduplicated on the subject, so a retried webhook
 * or a second press cannot send the welcome twice.
 */
export async function notifyLearner(input: {
  organizationId: string;
  eventKey: string;
  userId: string;
  subjectId: string;
  context: Record<string, string>;
}): Promise<void> {
  try {
    const user = await db.user.findFirst({
      where: { id: input.userId, organizationId: input.organizationId },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!user) return;
    await queueNotifications({
      organizationId: input.organizationId,
      eventKey: input.eventKey,
      recipients: [{ userId: user.id, email: user.email, phone: user.phone }],
      dedupeKey: `${input.eventKey}:${input.subjectId}`,
      context: { name: user.name, ...input.context },
    });
  } catch (err) {
    console.error(`[events] notification ${input.eventKey}`, err instanceof Error ? err.message : err);
  }
}
