import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { FAMILY_NAMES } from '@/lib/exams/registry';

/**
 * Test packs: a TEST_SERIES product whose TestPack row says how many papers
 * of which test (a level, or any level of the family) and for how long.
 * Sold through the ordinary cart and checkout; the payment writes a PACK
 * allowance keyed on the order line, and a full refund withdraws it.
 */

export interface PackCard {
  productId: string;
  slug: string;
  title: string;
  familyCode: string;
  level: string | null;
  tests: number | null;
  validityDays: number | null;
  description: string | null;
  pricingPlanId: string | null;
  pricePaise: number | null;
  mrpPaise: number | null;
  currency: string;
}

export async function packsOnSale(organizationId: string, filter: { familyCode?: string; level?: string | null } = {}): Promise<PackCard[]> {
  const rows = await db.product.findMany({
    where: {
      organizationId,
      type: 'TEST_SERIES',
      status: 'PUBLISHED',
      deletedAt: null,
      testPack: filter.familyCode
        ? { familyCode: filter.familyCode, ...(filter.level !== undefined ? { OR: [{ level: filter.level }, { level: null }] } : {}) }
        : { isNot: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slug: true,
      title: true,
      testPack: true,
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true, pricePaise: true, mrpPaise: true, currency: true } },
    },
  });
  return rows
    .filter((r) => r.testPack)
    .map((r) => ({
      productId: r.id,
      slug: r.slug,
      title: r.title,
      familyCode: r.testPack!.familyCode,
      level: r.testPack!.level,
      tests: r.testPack!.tests,
      validityDays: r.testPack!.validityDays,
      description: r.testPack!.description,
      pricingPlanId: r.pricingPlans[0]?.id ?? null,
      pricePaise: r.pricingPlans[0]?.pricePaise ?? null,
      mrpPaise: r.pricingPlans[0]?.mrpPaise ?? null,
      currency: r.pricingPlans[0]?.currency ?? 'INR',
    }));
}

export function packLine(p: { familyCode: string; level: string | null; tests: number | null; validityDays: number | null }): string {
  const what = `${FAMILY_NAMES[p.familyCode] ?? p.familyCode}${p.level ? ` ${p.level}` : ', any level'}`;
  const count = p.tests == null ? 'Unlimited papers' : `${p.tests} paper${p.tests === 1 ? '' : 's'}`;
  return `${count} · ${what}${p.validityDays ? ` · ${p.validityDays} days` : ''}`;
}

/** Inside the fulfilment transaction: one PACK allowance per paid order line, written once. */
export async function grantPackInTx(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; userId: string; productId: string; orderItemId: string; pack: { familyCode: string; level: string | null; tests: number | null; validityDays: number | null } },
): Promise<void> {
  const already = await tx.examAllowance.findFirst({ where: { organizationId: input.organizationId, orderItemId: input.orderItemId }, select: { id: true } });
  if (already) return;
  await tx.examAllowance.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      familyCode: input.pack.familyCode,
      level: input.pack.level,
      tests: input.pack.tests,
      source: 'PACK',
      productId: input.productId,
      orderItemId: input.orderItemId,
      expiresAt: input.pack.validityDays ? new Date(Date.now() + input.pack.validityDays * 86_400_000) : null,
    },
  });
}

/** A full refund: the papers bought on those order lines are withdrawn. Papers already sat stay sat. */
export async function withdrawPacks(organizationId: string, orderItemIds: string[]): Promise<number> {
  if (!orderItemIds.length) return 0;
  const r = await db.examAllowance.updateMany({
    where: { organizationId, orderItemId: { in: orderItemIds }, source: 'PACK', revokedAt: null },
    data: { revokedAt: new Date(), note: 'Refunded.' },
  });
  return r.count;
}
