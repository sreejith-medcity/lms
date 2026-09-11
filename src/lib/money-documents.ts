import type { SessionUser } from '@/lib/auth';

/**
 * Who may open a receipt or invoice: the learner it was issued to, or staff
 * who handle money. Anyone else gets a 404 rather than a 403, so a guessed
 * number confirms nothing.
 */
export function mayViewMoneyDocument(user: SessionUser, ownerId: string | null): boolean {
  if (ownerId && user.id === ownerId) return true;
  if (user.kind !== 'STAFF') return false;
  return Boolean(
    user.permissions['sales.payments']?.view || user.permissions['sales.fee_tracking']?.view,
  );
}
