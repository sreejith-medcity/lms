import { db } from '@/lib/db';
import { limitsFor, measureUsage } from './billing';
import { capReached } from './billing-rules';

/**
 * Whether the plan lets one more of something in. Only hard caps refuse;
 * an included figure with an overage price bills instead. Best effort:
 * a failure to read the plan never blocks the office.
 */
export async function planAllows(tenantId: string, metric: 'STAFF_SEATS' | 'BRANCHES' | 'COURSES' | 'ACTIVE_LEARNERS'): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const sub = await db.tenantSubscription.findUnique({ where: { tenantId }, select: { planId: true } });
    if (!sub) return { ok: true };
    const [limits, usage] = await Promise.all([limitsFor(sub.planId, tenantId), measureUsage(tenantId)]);
    const used = usage.find((u) => u.metric === metric)?.quantity ?? 0;
    if (!capReached(limits, metric, used)) return { ok: true };
    const label = metric === 'STAFF_SEATS' ? 'staff seats' : metric === 'BRANCHES' ? 'branches' : metric === 'COURSES' ? 'courses' : 'active learners';
    return { ok: false, message: `The plan's limit on ${label} is reached. Change the plan under Settings, Billing to add more.` };
  } catch {
    return { ok: true };
  }
}
