/**
 * Help tickets: a learner's question to the office, from inside the portal.
 *
 * Routed to the learner's branch and kept as a thread, so the answer sits
 * with the record rather than in somebody's inbox. Statuses are few on
 * purpose: open (the office owes a reply), waiting on the learner, resolved,
 * closed.
 */

export const HELP_CATEGORIES = [
  { key: 'FEES', label: 'Fees and payments', hint: 'A receipt, an instalment, a refund.' },
  { key: 'CLASSES', label: 'Classes and schedule', hint: 'A join link, a missed class, a batch change.' },
  { key: 'CONTENT', label: 'Course content', hint: 'A lesson that will not play, a wrong answer key.' },
  { key: 'CERTIFICATE', label: 'Certificates and results', hint: 'A certificate, a mark, a report card.' },
  { key: 'ACCOUNT', label: 'My account', hint: 'Sign-in, a wrong name or number.' },
  { key: 'OTHER', label: 'Something else', hint: '' },
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number]['key'];
export type HelpStatus = 'OPEN' | 'WAITING_ON_LEARNER' | 'RESOLVED' | 'CLOSED';

export function categoryLabel(key: string): string {
  return HELP_CATEGORIES.find((c) => c.key === key)?.label ?? 'Something else';
}

export function isCategory(key: string): key is HelpCategory {
  return HELP_CATEGORIES.some((c) => c.key === key);
}

export function ticketProblem(input: { subject: string; body: string }): string | null {
  if (input.subject.trim().length < 3) return 'Give it a subject.';
  if (input.subject.trim().length > 140) return 'Keep the subject under 140 characters.';
  if (input.body.trim().length < 10) return 'Say a little more, so the office can help without asking.';
  if (input.body.trim().length > 5000) return 'That is longer than a message needs to be.';
  return null;
}

export function replyProblem(body: string): string | null {
  if (body.trim().length < 1) return 'Write something first.';
  if (body.trim().length > 5000) return 'That is longer than a message needs to be.';
  return null;
}

export const STATUS_LABEL: Record<HelpStatus, string> = {
  OPEN: 'Open',
  WAITING_ON_LEARNER: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** The same statuses read from the office's side. */
export const STATUS_LABEL_STAFF: Record<HelpStatus, string> = {
  OPEN: 'Needs a reply',
  WAITING_ON_LEARNER: 'Waiting on the learner',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function statusTone(status: string): 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' {
  if (status === 'OPEN') return 'warn';
  if (status === 'WAITING_ON_LEARNER') return 'brand';
  if (status === 'RESOLVED') return 'ok';
  return 'neutral';
}

export function isOpenStatus(status: string): boolean {
  return status === 'OPEN' || status === 'WAITING_ON_LEARNER';
}

/**
 * What a message does to the status. A learner writing reopens a resolved
 * ticket and hands it back to the office; the office writing hands it to
 * the learner unless they said it is resolved.
 */
export function statusAfterMessage(current: string, fromStaff: boolean, resolve = false): HelpStatus {
  if (fromStaff) return resolve ? 'RESOLVED' : 'WAITING_ON_LEARNER';
  return 'OPEN';
}

/** Days since the office last owed a reply, for the queue's ordering and its red numbers. */
export function waitingDays(lastMessageAt: Date, status: string, now: Date): number {
  if (status !== 'OPEN') return 0;
  return Math.floor((now.getTime() - lastMessageAt.getTime()) / 864e5);
}

export function waitingLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'a day';
  return `${days} days`;
}
