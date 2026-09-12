import { db } from '@/lib/db';

/**
 * What a learner sees across the top, and in what order.
 *
 * An institute that sells one self-paced course does not want a community tab,
 * and one running eighteen branches of live classes wants it first. So the list
 * is a setting rather than a constant, stored as ordered keys and read back
 * against this catalogue: an unknown key is dropped rather than rendered, so a
 * stale setting cannot produce a dead link.
 */

export const LEARNER_NAV_ITEMS = [
  { key: 'learning', label: 'My learning', href: '/learn' },
  { key: 'community', label: 'Community', href: '/learn/community' },
  { key: 'wallet', label: 'Credit', href: '/learn/wallet' },
  { key: 'one-to-one', label: 'One to one', href: '/learn/book' },
  { key: 'purchases', label: 'Purchases', href: '/learn/purchases' },
  { key: 'fees', label: 'Fees', href: '/learn/fees' },
  { key: 'practice', label: 'Practice', href: '/learn/practice' },
  { key: 'account', label: 'Account', href: '/learn/account' },
  { key: 'explore', label: 'Explore', href: '/' },
] as const;

export type LearnerNavKey = (typeof LEARNER_NAV_ITEMS)[number]['key'];

export const LEARNER_NAV_SETTING = 'learner.nav';

/** My learning is not optional: a portal with no way back to the courses is a bug. */
const REQUIRED: LearnerNavKey = 'learning';

export const DEFAULT_LEARNER_NAV: LearnerNavKey[] = ['learning', 'practice', 'purchases', 'explore'];

export interface LearnerNavItem {
  key: string;
  label: string;
  href: string;
}

export function resolveNav(stored: unknown): LearnerNavItem[] {
  const keys = Array.isArray(stored) ? stored.map(String) : DEFAULT_LEARNER_NAV;
  const ordered = keys.includes(REQUIRED) ? keys : [REQUIRED, ...keys];

  return ordered
    .map((key) => LEARNER_NAV_ITEMS.find((item) => item.key === key))
    .filter((item): item is (typeof LEARNER_NAV_ITEMS)[number] => Boolean(item))
    .map((item) => ({ key: item.key, label: item.label, href: item.href }));
}

export async function learnerNav(organizationId: string): Promise<LearnerNavItem[]> {
  const setting = await db.orgSetting.findUnique({
    where: { organizationId_key: { organizationId, key: LEARNER_NAV_SETTING } },
    select: { value: true },
  });
  return resolveNav(setting?.value);
}
