/**
 * Pricing templates: a reusable shape for a price.
 *
 * The shape is how it is paid, in how many parts, how far apart, what share
 * each part takes, and how long access lasts. A plan made from a template
 * copies the values, so a template edited next year does not move a price
 * under anybody already on it.
 */

export type TemplatePlanType = 'ONE_TIME' | 'INSTALMENT' | 'SUBSCRIPTION';

export interface TemplateShape {
  planType: TemplatePlanType | string;
  instalmentCount: number;
  gapDays: number;
  /** Percent per part, adding to 100; empty means equal parts. */
  shares: number[];
  validityDays: number | null;
  invoiceAnchor: string;
}

export interface ScheduledPart {
  dueOffsetDays: number;
  amountPaise: number;
}

/** "40, 30, 30" or "40/30/30" to numbers; blanks and junk are dropped. */
export function parseShares(raw: string): number[] {
  return raw
    .split(/[\s,/;]+/)
    .map((p) => Number(p.replace('%', '')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
}

/** Why the shares cannot be used, or null when they can. */
export function sharesProblem(shares: number[], count: number): string | null {
  if (shares.length === 0) return null;
  if (shares.length !== count) return `The shares name ${shares.length} parts but the plan has ${count}.`;
  const total = shares.reduce((n, s) => n + s, 0);
  if (total !== 100) return `The shares add up to ${total}%, not 100%.`;
  return null;
}

/**
 * The dues for a price under a template. Equal parts when there are no
 * shares, with the odd paise on the first part, so a fee of 10,000 in
 * three is 3,334 + 3,333 + 3,333 and never a rupee nobody can collect.
 */
export function scheduleFromTemplate(totalPaise: number, t: Pick<TemplateShape, 'instalmentCount' | 'gapDays' | 'shares'>): ScheduledPart[] {
  const count = Math.max(1, Math.round(t.instalmentCount));
  const gap = Math.max(1, Math.round(t.gapDays));
  const shares = sharesProblem(t.shares, count) === null && t.shares.length === count ? t.shares : Array.from({ length: count }, () => 1);
  const weight = shares.reduce((n, s) => n + s, 0);
  const amounts = shares.map((s) => Math.floor((totalPaise * s) / weight));
  amounts[0] += totalPaise - amounts.reduce((n, a) => n + a, 0);
  return amounts.map((amountPaise, i) => ({ dueOffsetDays: i * gap, amountPaise }));
}

const ANCHOR: Record<string, string> = {
  CLASS_COMMENCEMENT: 'from the batch start',
  ENROLLMENT: 'from the day they enrol',
};

/** One line the office can read: "3 parts of 40/30/30, 30 days apart from the batch start, access for a year". */
export function describeTemplate(t: TemplateShape): string {
  const bits: string[] = [];
  if (t.planType === 'INSTALMENT') {
    const split = t.shares.length === t.instalmentCount ? ` of ${t.shares.join('/')}` : '';
    bits.push(`${t.instalmentCount} parts${split}, ${t.gapDays} days apart ${ANCHOR[t.invoiceAnchor] ?? ANCHOR.CLASS_COMMENCEMENT}`);
  } else if (t.planType === 'SUBSCRIPTION') bits.push('a subscription');
  else bits.push('paid in full, once');
  if (t.validityDays) bits.push(t.validityDays % 365 === 0 ? `access for ${t.validityDays / 365 === 1 ? 'a year' : `${t.validityDays / 365} years`}` : `access for ${t.validityDays} days`);
  else bits.push('access does not expire');
  return bits.join(', ');
}

export function templateProblem(input: { name: string; planType: string; instalmentCount: number; gapDays: number; shares: number[] }): string | null {
  if (input.name.trim().length < 2) return 'Give the template a name.';
  if (!['ONE_TIME', 'INSTALMENT', 'SUBSCRIPTION'].includes(input.planType)) return 'Pick how it is paid.';
  if (input.planType === 'INSTALMENT') {
    if (input.instalmentCount < 2 || input.instalmentCount > 24) return 'An instalment plan has between 2 and 24 parts.';
    if (input.gapDays < 1 || input.gapDays > 365) return 'Parts are between 1 and 365 days apart.';
    return sharesProblem(input.shares, input.instalmentCount);
  }
  return null;
}
