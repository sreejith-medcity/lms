import { db } from '@/lib/db';
import { isEngine, type LoyaltyEngine } from '@/lib/loyalty-contract';

/**
 * Which loyalty engine is in charge.
 *
 * There are two possible answers now and they must never both be true. Phase 4
 * built points and referrals into this product; loyalty proper is becoming a
 * separate platform. If both are live a learner earns twice for one purchase
 * and the two ledgers disagree forever, which is the kind of bug found by a
 * customer counting their own points.
 *
 * So it is one setting, read in one place, and every earn path asks here.
 */

const SETTING = 'pref.loyalty.engine';

export async function loyaltyEngine(organizationId: string): Promise<LoyaltyEngine> {
  const row = await db.orgSetting.findFirst({
    where: { organizationId, key: SETTING },
    select: { value: true },
  });

  const value = typeof row?.value === 'string' ? row.value : null;
  // Anything unrecognised falls back to what is running today rather than
  // silently switching an academy's scheme off.
  return isEngine(value) ? value : 'built-in';
}

/**
 * May this product credit points itself.
 *
 * The external platform is told what happened either way, through the ordinary
 * webhooks, so switching to it loses no information. It changes who does the
 * arithmetic.
 */
export async function mayAwardInternally(organizationId: string): Promise<boolean> {
  return (await loyaltyEngine(organizationId)) === 'built-in';
}

export {
  isEngine,
  memberRef,
  LOYALTY_EVENTS,
  type LoyaltyEngine,
  type MemberRef,
} from '@/lib/loyalty-contract';
