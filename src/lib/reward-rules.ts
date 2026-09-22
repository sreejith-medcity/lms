/**
 * The rules behind stamp cards, vouchers and achievements, with no database
 * in them so they can be tested on their own.
 *
 * A voucher is an instrument issued to one person and spent once; a promo
 * code is a price rule anybody may use. A stamp card is so many stamps and
 * then a reward, legible without arithmetic. An achievement is one thing a
 * learner did, measured here, awarded once per thing.
 */

export type VoucherKind = 'PERCENT' | 'FLAT';
export type VoucherStatus = 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export interface VoucherLike {
  kind: VoucherKind | string;
  /** Percent for PERCENT, paise for FLAT. */
  value: number;
  maxDiscountPaise: number | null;
}

/** What a voucher takes off an order: never below zero, never more than the order. */
export function voucherDiscount(v: VoucherLike, subtotalPaise: number): number {
  const raw = v.kind === 'FLAT' ? v.value : Math.round((subtotalPaise * v.value) / 100);
  const capped = v.maxDiscountPaise != null ? Math.min(raw, v.maxDiscountPaise) : raw;
  return Math.max(0, Math.min(capped, subtotalPaise));
}

export function describeVoucher(v: VoucherLike, currency = 'INR'): string {
  const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(paise / 100);
  if (v.kind === 'FLAT') return `${money(v.value)} off`;
  const cap = v.maxDiscountPaise ? `, up to ${money(v.maxDiscountPaise)}` : '';
  return `${v.value}% off${cap}`;
}

/**
 * Codes are read out over a counter and typed from a printout, so the
 * alphabet leaves out the letters and digits people confuse (0 and O, 1
 * and I and L, 8 and B, 5 and S), and the groups are short.
 */
export const VOUCHER_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ234679';

/** A code from a source of random indexes, so the generator can be tested and the crypto stays server-side. */
export function voucherCodeFrom(pick: (n: number) => number, prefix = 'V'): string {
  const group = () => Array.from({ length: 4 }, () => VOUCHER_ALPHABET[pick(VOUCHER_ALPHABET.length)]).join('');
  return `${prefix}-${group()}-${group()}`;
}

/** How a typed code is compared: case and the dashes people leave out do not matter. */
export function normaliseVoucherCode(raw: string): string {
  const bare = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!bare) return '';
  // Put the dashes back in the shape they were printed in, so V-ABCD-EFGH
  // typed as VABCDEFGH still matches.
  const m = bare.match(/^([A-Z]{1,2})([A-Z0-9]{4})([A-Z0-9]{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : bare;
}

/**
 * A voucher code is told apart from a promo code by its printed shape: a
 * one or two letter prefix and two groups of four from the voucher
 * alphabet. A promo code that happens to fit is still looked up as a
 * promo when no voucher has the code, so the shape only decides which
 * table is asked first.
 */
export function looksLikeVoucher(raw: string): boolean {
  const code = normaliseVoucherCode(raw);
  const m = code.match(/^[A-Z]{1,2}-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  return Boolean(m) && [...(m![1] + m![2])].every((ch) => VOUCHER_ALPHABET.includes(ch));
}

export type VoucherRefusal = 'NOT_FOUND' | 'EXPIRED' | 'REDEEMED' | 'CANCELLED' | 'NOT_YOURS' | 'WRONG_PRODUCT' | 'NOTHING_OFF';

export function voucherRefusalMessage(reason: VoucherRefusal): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'That voucher does not exist. Check the code.';
    case 'EXPIRED':
      return 'That voucher has expired.';
    case 'REDEEMED':
      return 'That voucher has already been spent.';
    case 'CANCELLED':
      return 'That voucher was cancelled.';
    case 'NOT_YOURS':
      return 'That voucher belongs to somebody else.';
    case 'WRONG_PRODUCT':
      return 'That voucher is not valid on this course.';
    case 'NOTHING_OFF':
      return 'That voucher takes nothing off this order.';
  }
}

/**
 * Whether a voucher can be spent by this person on this course right now.
 * A printed voucher nobody has claimed yet is claimed by spending it.
 */
export function voucherRefusal(
  v: { status: VoucherStatus | string; expiresAt: Date | null; userId: string | null; productId: string | null },
  input: { userId: string; productId: string | null; now?: Date },
): VoucherRefusal | null {
  if (v.status === 'REDEEMED') return 'REDEEMED';
  if (v.status === 'CANCELLED') return 'CANCELLED';
  if (v.status === 'EXPIRED' || (v.expiresAt && v.expiresAt < (input.now ?? new Date()))) return 'EXPIRED';
  if (v.userId && v.userId !== input.userId) return 'NOT_YOURS';
  if (v.productId && input.productId && v.productId !== input.productId) return 'WRONG_PRODUCT';
  return null;
}

/** A stamp added: whether the card is now full, and how many stamps show. */
export function stampOutcome(stampsBefore: number, needed: number): { stamps: number; full: boolean } {
  const stamps = stampsBefore + 1;
  return stamps >= Math.max(1, needed) ? { stamps: 0, full: true } : { stamps, full: false };
}

/**
 * "Sat every class in a month": true when the month is over for that batch
 * (every class of it has ended), at least `minClasses` were held, and the
 * learner was present or late at all of them. Cancelled classes and
 * holidays are not in the list to begin with.
 */
export function fullMonth(classes: { endsAt: Date; attended: boolean }[], minClasses: number, now = new Date()): boolean {
  if (classes.length < Math.max(1, minClasses)) return false;
  if (classes.some((c) => c.endsAt > now)) return false;
  return classes.every((c) => c.attended);
}

export type AchievementRule = 'MODULE_FINISHED' | 'COURSE_COMPLETED' | 'PASSED_FIRST_ATTEMPT' | 'FULL_MONTH_ATTENDANCE' | 'STREAK_DAYS';

export const ACHIEVEMENT_RULES: { rule: AchievementRule; label: string; thresholdLabel: string | null; how: string }[] = [
  { rule: 'MODULE_FINISHED', label: 'Finished a module', thresholdLabel: null, how: 'Every lesson of a module marked done. Once per module.' },
  { rule: 'COURSE_COMPLETED', label: 'Finished a course', thresholdLabel: null, how: 'The course reached 100%. Once per course.' },
  { rule: 'PASSED_FIRST_ATTEMPT', label: 'Passed at the first attempt', thresholdLabel: 'Score at least, %', how: 'A test passed on attempt one, at or above the score. Once per test.' },
  { rule: 'FULL_MONTH_ATTENDANCE', label: 'Sat every class in a month', thresholdLabel: 'Classes held in the month, at least', how: 'Present at every class of a batch in a calendar month, once the month is over. Once per batch and month.' },
  { rule: 'STREAK_DAYS', label: 'A learning streak', thresholdLabel: 'Days in a row', how: 'Learning on this many days in a row. Once per length.' },
];

export function ruleLabel(rule: string): string {
  return ACHIEVEMENT_RULES.find((r) => r.rule === rule)?.label ?? rule;
}

/** Whether a measured value meets a rule's threshold. Rules without a number are met by happening. */
export function ruleMet(rule: AchievementRule | string, threshold: number, value: number): boolean {
  switch (rule) {
    case 'PASSED_FIRST_ATTEMPT':
    case 'FULL_MONTH_ATTENDANCE':
    case 'STREAK_DAYS':
      return value >= Math.max(1, threshold);
    default:
      return true;
  }
}
