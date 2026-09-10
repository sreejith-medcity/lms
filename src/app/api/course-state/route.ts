import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { loyaltyConfig, pointsToPaise, redeemablePoints } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

/**
 * The three things about a course page that depend on who is looking.
 *
 * Split out so the page itself can be the same for everybody and held at the
 * edge. Course pages are where search traffic lands and where a buyer decides,
 * so they are the ones most worth serving from a cache, and they were the only
 * public pages that could not be.
 *
 * Answers `private, no-store`, always. This is the per-user part; if it were
 * ever cached the whole point would be lost, and worse than lost.
 */
export async function GET(request: Request) {
  const productId = new URL(request.url).searchParams.get('productId');

  const nothing = {
    signedIn: false,
    enrolled: false,
    pointsWorthPaise: 0,
  };

  const headers = { 'Cache-Control': 'private, no-store' };

  if (!productId) return NextResponse.json(nothing, { headers });

  const [tenant, user] = await Promise.all([getTenantContext(), getSessionUser()]);
  if (!tenant || !user) return NextResponse.json(nothing, { headers });

  const product = await db.product.findFirst({
    where: { id: productId, organizationId: tenant.organizationId, deletedAt: null },
    select: { id: true, pricingPlans: { take: 1, select: { pricePaise: true } } },
  });
  if (!product) return NextResponse.json({ ...nothing, signedIn: true }, { headers });

  const [enrollment, loyalty] = await Promise.all([
    db.enrollment.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId: user.id,
        productId: product.id,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      },
      select: { id: true },
    }),
    loyaltyConfig(tenant.organizationId),
  ]);

  const plan = product.pricingPlans[0];

  const balance =
    loyalty.enabled && plan
      ? (
          await db.walletAccount.findUnique({
            where: { userId: user.id },
            select: { balancePoints: true },
          })
        )?.balancePoints ?? 0
      : 0;

  return NextResponse.json(
    {
      signedIn: true,
      enrolled: Boolean(enrollment),
      pointsWorthPaise: plan
        ? pointsToPaise(redeemablePoints(balance, plan.pricePaise, loyalty), loyalty)
        : 0,
    },
    { headers },
  );
}
