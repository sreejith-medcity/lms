import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { DUE_DAYS, cycleAmount, invoiceNumber, invoiceTotals, overageLines, periodEnd, standing, type Cycle, type LimitRow, type UsageRow } from './billing-rules';

/**
 * Tenant billing: what each academy owes the platform, and whether it
 * keeps working.
 *
 * Usage is counted nightly into UsageRecord. At the end of a period the
 * subscription is renewed with an invoice for the next period plus any
 * overage from the one that ended. An unpaid invoice past its due date
 * marks the academy past due; past grace, it is paused. Paying it puts
 * everything back. The platform's own gateway keys are in the environment,
 * separate from any academy's.
 */

/* Usage --------------------------------------------------------------------- */

const DAY_MS = 864e5;

export async function measureUsage(tenantId: string, now = new Date()): Promise<UsageRow[]> {
  const orgs = await db.organization.findMany({ where: { tenantId }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  if (orgIds.length === 0) return [];
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [learners, staff, branches, courses, storage] = await Promise.all([
    db.user.count({ where: { organizationId: { in: orgIds }, kind: 'LEARNER', deletedAt: null, lastSeenAt: { gte: since } } }),
    db.user.count({ where: { organizationId: { in: orgIds }, kind: 'STAFF', deletedAt: null, status: 'ACTIVE' } }),
    db.branch.count({ where: { organizationId: { in: orgIds }, isActive: true } }),
    db.product.count({ where: { organizationId: { in: orgIds }, type: 'COURSE', deletedAt: null } }),
    db.asset.aggregate({ where: { organizationId: { in: orgIds } }, _sum: { sizeBytes: true } }),
  ]);
  return [
    { metric: 'ACTIVE_LEARNERS', quantity: learners },
    { metric: 'STAFF_SEATS', quantity: staff },
    { metric: 'BRANCHES', quantity: branches },
    { metric: 'COURSES', quantity: courses },
    { metric: 'STORAGE_BYTES', quantity: Number(storage._sum.sizeBytes ?? 0) },
  ];
}

/** Today's figures, written once per day per metric. */
export async function recordUsage(tenantId: string, now = new Date()): Promise<void> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const row of await measureUsage(tenantId, now)) {
    await db.usageRecord.upsert({
      where: { tenantId_metric_day: { tenantId, metric: row.metric as never, day } },
      create: { tenantId, metric: row.metric as never, day, quantity: BigInt(row.quantity) },
      update: { quantity: BigInt(row.quantity) },
    });
  }
}

export async function limitsFor(planId: string, tenantId: string): Promise<LimitRow[]> {
  const [limits, entitlements] = await Promise.all([
    db.planLimit.findMany({ where: { planId }, select: { metric: true, included: true, hardCap: true, overagePaisePerUnit: true } }),
    db.tenantEntitlement.findMany({ where: { tenantId, metric: { not: null } }, select: { metric: true, included: true, expiresAt: true } }),
  ]);
  return limits.map((l) => {
    const extra = entitlements.find((e) => e.metric === l.metric && (!e.expiresAt || e.expiresAt > new Date()));
    return { metric: l.metric, included: Number(l.included) + Number(extra?.included ?? 0), hardCap: l.hardCap === null ? null : Number(l.hardCap) + Number(extra?.included ?? 0), overagePaisePerUnit: l.overagePaisePerUnit };
  });
}

/** The highest daily figure per metric in a window, which is what overage is billed on. */
export async function peakUsage(tenantId: string, from: Date, to: Date): Promise<UsageRow[]> {
  const rows = await db.usageRecord.groupBy({ by: ['metric'], where: { tenantId, day: { gte: from, lt: to } }, _max: { quantity: true } });
  return rows.map((r) => ({ metric: r.metric, quantity: Number(r._max.quantity ?? 0) }));
}

/* Invoices ------------------------------------------------------------------ */

async function nextInvoiceNo(now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `PLT-${year}-`;
  const latest = await db.tenantInvoice.findFirst({ where: { invoiceNo: { startsWith: prefix } }, orderBy: { invoiceNo: 'desc' }, select: { invoiceNo: true } });
  const seq = latest ? Number(latest.invoiceNo.slice(prefix.length)) + 1 : 1;
  return invoiceNumber(year, seq);
}

/** An invoice for a period on a plan, with overage from the period that ended. */
export async function issueInvoice(input: { tenantId: string; planId: string; cycle: Cycle; periodStart: Date; periodEnd: Date; overageFrom?: Date; overageTo?: Date; now?: Date }): Promise<{ id: string; invoiceNo: string; totalPaise: number }> {
  const now = input.now ?? new Date();
  const plan = await db.plan.findUniqueOrThrow({ where: { id: input.planId }, select: { name: true, monthlyPaise: true, quarterlyPaise: true, annualPaise: true } });
  const subscriptionPaise = cycleAmount(plan, input.cycle);
  const overage = input.overageFrom && input.overageTo ? overageLines(await peakUsage(input.tenantId, input.overageFrom, input.overageTo), await limitsFor(input.planId, input.tenantId)) : [];
  const totals = invoiceTotals(subscriptionPaise, overage);
  const lineItems = [
    { kind: 'plan', label: `${plan.name} plan, ${input.cycle.toLowerCase()}`, paise: subscriptionPaise },
    ...overage.map((o) => ({ kind: 'overage', label: `${o.metric}: ${o.over} over the ${o.included} included`, paise: o.paise })),
    { kind: 'tax', label: 'GST 18%', paise: totals.taxPaise },
  ];
  const invoice = await db.tenantInvoice.create({
    data: {
      tenantId: input.tenantId,
      invoiceNo: await nextInvoiceNo(now),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      subtotalPaise: totals.subtotalPaise,
      overagePaise: totals.overagePaise,
      taxPaise: totals.taxPaise,
      totalPaise: totals.totalPaise,
      status: 'DUE',
      dueDate: new Date(now.getTime() + DUE_DAYS * DAY_MS),
      lineItems: lineItems as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, invoiceNo: true, totalPaise: true },
  });
  return invoice;
}

/* The nightly run ----------------------------------------------------------- */

export async function runPlatformBilling(now = new Date()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const tenants = await db.tenant.findMany({
    where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
    select: { id: true, slug: true, status: true, trialEndsAt: true, subscription: { select: { id: true, status: true, planId: true, billingCycle: true, currentPeriodStart: true, currentPeriodEnd: true, nextPlanId: true, nextBillingCycle: true, cancelAtPeriodEnd: true } } },
  });
  for (const t of tenants) {
    try {
      await recordUsage(t.id, now);
      const sub = t.subscription;
      if (!sub) continue;
      const oldest = await db.tenantInvoice.findFirst({ where: { tenantId: t.id, status: { in: ['DUE', 'OVERDUE'] } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } });
      const s = standing({ tenantStatus: t.status, subscriptionStatus: sub.status, currentPeriodEnd: sub.currentPeriodEnd, trialEndsAt: t.trialEndsAt, oldestDueUnpaid: oldest?.dueDate ?? null }, now);
      out[t.slug] = s.action;
      if (s.action === 'none') continue;

      if (s.action === 'suspend') {
        await db.tenant.update({ where: { id: t.id }, data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: 'Invoice unpaid past grace' } });
        await db.tenantSubscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
        await db.tenantInvoice.updateMany({ where: { tenantId: t.id, status: 'DUE', dueDate: { lt: now } }, data: { status: 'OVERDUE' } });
        continue;
      }
      if (s.action === 'past-due') {
        await db.tenant.update({ where: { id: t.id }, data: { status: 'PAST_DUE' } });
        await db.tenantSubscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        await db.tenantInvoice.updateMany({ where: { tenantId: t.id, status: 'DUE', dueDate: { lt: now } }, data: { status: 'OVERDUE' } });
        continue;
      }
      if (sub.cancelAtPeriodEnd) {
        await db.tenant.update({ where: { id: t.id }, data: { status: 'CANCELLED', churnedAt: now } });
        await db.tenantSubscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: now } });
        out[t.slug] = 'cancelled';
        continue;
      }
      // Trial ended or period ended: a new period on the plan that applies now, with an invoice.
      const planId = sub.nextPlanId ?? sub.planId;
      const cycle = (sub.nextBillingCycle ?? sub.billingCycle) as Cycle;
      const start = sub.currentPeriodEnd;
      const end = periodEnd(start, cycle);
      const plan = await db.plan.findUniqueOrThrow({ where: { id: planId }, select: { monthlyPaise: true, quarterlyPaise: true, annualPaise: true } });
      await issueInvoice({ tenantId: t.id, planId, cycle, periodStart: start, periodEnd: end, overageFrom: s.action === 'renew' ? sub.currentPeriodStart : undefined, overageTo: s.action === 'renew' ? sub.currentPeriodEnd : undefined, now });
      await db.tenantSubscription.update({ where: { id: sub.id }, data: { planId, billingCycle: cycle, amountPaise: cycleAmount(plan, cycle), status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, nextPlanId: null, nextBillingCycle: null } });
      if (t.status === 'TRIALING') await db.tenant.update({ where: { id: t.id }, data: { status: 'ACTIVE', trialEndsAt: null } });
    } catch (err) {
      out[t.slug] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return out;
}

/* Paying --------------------------------------------------------------------- */

export interface PlatformGateway {
  keyId: string;
  keySecret: string;
  testMode: boolean;
}

/** The platform's Razorpay account: its own keys, falling back to the app's for a one-academy install. */
export function platformGateway(): PlatformGateway | null {
  const keyId = (process.env.PLATFORM_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID ?? '').trim();
  const keySecret = (process.env.PLATFORM_RAZORPAY_KEY_SECRET ?? process.env.RAZORPAY_KEY_SECRET ?? '').trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, testMode: keyId.startsWith('rzp_test') };
}

export async function orderForInvoice(invoiceId: string): Promise<{ gatewayOrderId: string; keyId: string; testMode: boolean; amountPaise: number } | null> {
  const g = platformGateway();
  if (!g) return null;
  const invoice = await db.tenantInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNo: true, totalPaise: true, gatewayOrderId: true, status: true } });
  if (!invoice || invoice.status === 'PAID' || invoice.status === 'VOID') return null;
  if (invoice.gatewayOrderId) return { gatewayOrderId: invoice.gatewayOrderId, keyId: g.keyId, testMode: g.testMode, amountPaise: invoice.totalPaise };
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${g.keyId}:${g.keySecret}`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: invoice.totalPaise, currency: 'INR', receipt: invoice.invoiceNo.slice(0, 40), notes: { invoiceId: invoice.id, kind: 'platform' }, payment_capture: 1 }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => null)) as { id?: string; error?: { description?: string } } | null;
  if (!res.ok || !body?.id) throw new Error(`RAZORPAY: ${body?.error?.description ?? res.status}`);
  await db.tenantInvoice.update({ where: { id: invoice.id }, data: { gatewayOrderId: body.id } });
  return { gatewayOrderId: body.id, keyId: g.keyId, testMode: g.testMode, amountPaise: invoice.totalPaise };
}

export function platformSignatureValid(orderId: string, paymentId: string, signature: string): boolean {
  const g = platformGateway();
  if (!g) return false;
  const expected = createHmac('sha256', g.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** An invoice paid, by the gateway or by hand: the academy is back in good standing. */
export async function settleInvoice(invoiceId: string, input: { paymentId?: string | null; reference?: string | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const invoice = await db.tenantInvoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: now, gatewayPaymentId: input.paymentId ?? null, paidReference: input.reference ?? null }, select: { tenantId: true } });
  const unpaid = await db.tenantInvoice.count({ where: { tenantId: invoice.tenantId, status: { in: ['DUE', 'OVERDUE'] } } });
  if (unpaid === 0) {
    await db.tenant.updateMany({ where: { id: invoice.tenantId, status: { in: ['PAST_DUE', 'SUSPENDED'] } }, data: { status: 'ACTIVE', suspendedAt: null, suspendReason: null } });
    await db.tenantSubscription.updateMany({ where: { tenantId: invoice.tenantId, status: { in: ['PAST_DUE', 'PAUSED'] } }, data: { status: 'ACTIVE' } });
  }
}
