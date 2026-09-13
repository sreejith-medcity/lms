/**
 * The affiliate programme: the rules with no database in them.
 *
 * A partner has a code; a visitor who arrives through it is remembered for
 * a while; an order they place in that while is the partner's sale, and the
 * commission is a share of what the academy actually kept (after discount,
 * before tax). Nothing is owed until the order is paid; a refund voids it.
 */

export const AFFILIATE_COOKIE = 'mlms_aff';
export const CODE_MIN = 3;
export const CODE_MAX = 24;

/** A code from a name: letters and digits, upper case, short. */
export function suggestCode(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase()
    .slice(0, 10);
  return base.length >= CODE_MIN ? base : `${base}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function codeProblem(code: string): string | null {
  if (!/^[A-Z0-9][A-Z0-9_-]*$/i.test(code)) return 'A code is letters, digits, - and _ only.';
  if (code.length < CODE_MIN) return `A code needs at least ${CODE_MIN} characters.`;
  if (code.length > CODE_MAX) return `Keep the code under ${CODE_MAX} characters.`;
  return null;
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

export function percentProblem(percent: number): string | null {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 'Commission is a percentage between 0 and 100.';
  return null;
}

/** The base and the share, in paise, rounded down: the academy keeps the paisa. */
export function commissionFor(order: { subtotalPaise: number; discountPaise: number }, percent: number): { basePaise: number; commissionPaise: number } {
  const basePaise = Math.max(0, order.subtotalPaise - order.discountPaise);
  const commissionPaise = Math.floor((basePaise * Math.max(0, Math.min(100, percent))) / 100);
  return { basePaise, commissionPaise };
}

/** What a partner's link looks like. */
export function affiliateLink(origin: string, code: string, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${origin}/a/${encodeURIComponent(code)}${clean === '/' ? '' : `?to=${encodeURIComponent(clean)}`}`;
}

/** Only paths on this site are followed after the click; anything else goes home. */
export function safeLanding(to: string | null | undefined): string {
  if (!to) return '/';
  if (!to.startsWith('/') || to.startsWith('//') || /[\r\n]/.test(to)) return '/';
  return to.slice(0, 500);
}

export type SaleStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'VOID';

export interface SaleTotals {
  pending: number;
  approved: number;
  paid: number;
  void: number;
  /** Approved and not yet paid to the partner. */
  owedPaise: number;
  paidPaise: number;
}

export function saleTotals(sales: { status: string; commissionPaise: number }[]): SaleTotals {
  const t: SaleTotals = { pending: 0, approved: 0, paid: 0, void: 0, owedPaise: 0, paidPaise: 0 };
  for (const s of sales) {
    if (s.status === 'PENDING') t.pending += 1;
    else if (s.status === 'APPROVED') {
      t.approved += 1;
      t.owedPaise += s.commissionPaise;
    } else if (s.status === 'PAID') {
      t.paid += 1;
      t.paidPaise += s.commissionPaise;
    } else if (s.status === 'VOID') t.void += 1;
  }
  return t;
}

/** The transitions the office may make by hand. */
export function canMarkPaid(status: string): boolean {
  return status === 'APPROVED';
}

export function canVoid(status: string): boolean {
  return status === 'PENDING' || status === 'APPROVED';
}
