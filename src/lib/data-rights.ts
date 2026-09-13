/**
 * Data rights: the rules with no database in them.
 *
 * A learner may take a copy of everything the academy holds on them, and
 * may ask to be forgotten. The first is done on the spot. The second is a
 * request the office closes one way or the other, because an academy has
 * obligations that outlive an account: invoices, certificates it has
 * issued, marks it has reported. Forgetting a person means taking the
 * person out of those records, not taking the records out.
 */

export const REASON_MAX = 1000;
export const NOTE_MAX = 1000;

export type DataRequestStatus = 'OPEN' | 'DONE' | 'REFUSED' | 'CANCELLED';

/** One open deletion request at a time; an export any time, within reason. */
export function deletionRequestProblem(open: { kind: string; status: string }[]): string | null {
  if (open.some((r) => r.kind === 'DELETION' && r.status === 'OPEN')) {
    return 'You have already asked. The academy is looking at it.';
  }
  return null;
}

/** Exports are cheap but not free: a handful a day is plenty. */
export const EXPORTS_PER_DAY = 5;

export function exportRateProblem(exportsToday: number): string | null {
  return exportsToday >= EXPORTS_PER_DAY ? 'You have taken a few copies today already. Try again tomorrow.' : null;
}

export interface DeletionContext {
  /** Enrolments that are live: the learner is mid-course. */
  activeEnrolments: number;
  /** Instalments not yet paid. */
  unpaidInstalments: number;
  /** Certificates issued to them and not revoked. */
  certificates: number;
  /** Paid orders on record. */
  paidOrders: number;
}

/**
 * What the office should know before closing a deletion. None of these
 * refuse the request; they are the things a person would want pointed out
 * before pressing a button that cannot be undone.
 */
export function deletionWarnings(ctx: DeletionContext): string[] {
  const out: string[] = [];
  if (ctx.activeEnrolments > 0) {
    out.push(`${ctx.activeEnrolments} live enrolment${ctx.activeEnrolments === 1 ? '' : 's'}: they lose access the moment this is done.`);
  }
  if (ctx.unpaidInstalments > 0) {
    out.push(`${ctx.unpaidInstalments} unpaid instalment${ctx.unpaidInstalments === 1 ? '' : 's'}: the dues stay on the books against an anonymous account.`);
  }
  if (ctx.certificates > 0) {
    out.push(`${ctx.certificates} certificate${ctx.certificates === 1 ? '' : 's'} issued: the verify page will keep working but show no name.`);
  }
  if (ctx.paidOrders > 0) {
    out.push(`${ctx.paidOrders} paid order${ctx.paidOrders === 1 ? '' : 's'}: invoices are kept, as the tax rules require, with the name already on them.`);
  }
  return out;
}

/**
 * What an anonymised account looks like. Everything that names or reaches
 * the person goes; the id stays so the financial rows still add up.
 */
export function anonymisedUser(userId: string): {
  name: string;
  email: null;
  phone: null;
  username: null;
  passwordHash: null;
  avatarUrl: null;
  dateOfBirth: null;
  gender: null;
  tags: string[];
  twoFactorSecret: null;
  twoFactorEnabledAt: null;
  twoFactorRecoveryCodes: string[];
  emailOptOut: true;
  smsOptOut: true;
  whatsappOptOut: true;
  status: 'ARCHIVED';
  deletedAt: Date;
} {
  return {
    name: `Deleted learner ${userId.slice(-6)}`,
    email: null,
    phone: null,
    username: null,
    passwordHash: null,
    avatarUrl: null,
    dateOfBirth: null,
    gender: null,
    tags: [],
    twoFactorSecret: null,
    twoFactorEnabledAt: null,
    twoFactorRecoveryCodes: [],
    emailOptOut: true,
    smsOptOut: true,
    whatsappOptOut: true,
    status: 'ARCHIVED',
    deletedAt: new Date(),
  };
}

/** Which closings are allowed from which state. */
export function canClose(status: DataRequestStatus): boolean {
  return status === 'OPEN';
}

export function statusLabel(status: DataRequestStatus): string {
  switch (status) {
    case 'OPEN':
      return 'Waiting';
    case 'DONE':
      return 'Done';
    case 'REFUSED':
      return 'Refused';
    case 'CANCELLED':
      return 'Withdrawn';
  }
}

/** The file name for an export. */
export function exportFileName(academy: string, at: Date): string {
  const slug = academy.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'academy';
  return `my-data-${slug}-${at.toISOString().slice(0, 10)}.json`;
}
