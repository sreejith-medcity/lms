import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';

export type UsageMetric = $Enums.UsageMetric;

/**
 * Every billable action calls this. Rolled up per tenant per day so the billing
 * engine and the tenant's own usage page read the same numbers.
 */
export async function meter(
  tenantId: string,
  metric: UsageMetric,
  quantity: number,
  costPaise = 0,
) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);

  await db.usageRecord.upsert({
    where: { tenantId_metric_day: { tenantId, metric, day } },
    create: { tenantId, metric, day, quantity: BigInt(quantity), costPaise },
    update: {
      quantity: { increment: BigInt(quantity) },
      costPaise: { increment: costPaise },
    },
  });
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  included: number;
  hardCap: number | null;
  reason?: string;
}

/** Called before any action that consumes a metered resource. */
export async function checkLimit(
  tenantId: string,
  metric: UsageMetric,
  wanted = 1,
): Promise<LimitCheck> {
  const sub = await db.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: { include: { limits: true } } },
  });

  const planLimit = sub?.plan.limits.find((l) => l.metric === metric);
  const override = await db.tenantEntitlement.findFirst({
    where: { tenantId, metric },
  });

  const included = Number(override?.included ?? planLimit?.included ?? 0);
  const hardCap = planLimit?.hardCap != null ? Number(planLimit.hardCap) : null;

  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const agg = await db.usageRecord.aggregate({
    where: { tenantId, metric, day: { gte: since } },
    _sum: { quantity: true },
  });

  const used = Number(agg._sum.quantity ?? 0n);

  if (hardCap != null && used + wanted > hardCap) {
    return { allowed: false, used, included, hardCap, reason: 'HARD_CAP_REACHED' };
  }
  return { allowed: true, used, included, hardCap };
}
