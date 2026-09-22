import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson } from '@/lib/api/http';
import { achievementsFor, claimVoucher, stampCardsFor, vouchersFor } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

/** The learner's stamp cards, achievements and vouchers, for the app's Rewards screen. */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const [cards, achievements, vouchers] = await Promise.all([
    stampCardsFor(ctx.tenant.organizationId, ctx.user.id),
    achievementsFor(ctx.tenant.organizationId, ctx.user.id),
    vouchersFor(ctx.tenant.organizationId, ctx.user.id),
  ]);
  return ok({
    stampCards: cards,
    achievements: achievements.map((a) => ({ ...a, awards: a.awards.map((w) => ({ context: w.context, awardedAt: w.awardedAt.toISOString() })) })),
    vouchers: vouchers.map((v) => ({ ...v, expiresAt: v.expiresAt?.toISOString() ?? null, redeemedAt: v.redeemedAt?.toISOString() ?? null })),
  });
}

/** Claim a printed voucher: `{ code }` from a scan or typed in. */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson<{ code?: string }>(request);
  const r = await claimVoucher(ctx.tenant.organizationId, ctx.user.id, String(body?.code ?? ''));
  if (!r.ok) return fail('refused', r.error, 400);
  return ok({ code: r.code, worth: r.worth, expiresAt: r.expiresAt?.toISOString() ?? null });
}
