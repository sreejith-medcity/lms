import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { memberCode } from '@/lib/member-card';
import { passesFor } from '@/lib/passes';

export const dynamic = 'force-dynamic';

/** The member card for the app to draw: the QR text, the number under it, and whether the card is live. */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const me = await db.user.findFirst({
    where: { id: ctx.user.id, organizationId: ctx.tenant.organizationId },
    select: { name: true, registrationNo: true, status: true, createdAt: true, branchMemberships: { where: { isPrimary: true }, select: { branch: { select: { name: true } } }, take: 1 } },
  });
  if (!me) return fail('unknown', 'Account not found.', 404);
  const passes = (await passesFor(ctx.tenant.organizationId, ctx.user.id)).filter((p) => p.status === 'ACTIVE');
  return ok({
    code: memberCode(ctx.user.id),
    name: me.name,
    registrationNo: me.registrationNo,
    branch: me.branchMemberships[0]?.branch.name ?? null,
    since: me.createdAt.toISOString(),
    active: me.status !== 'SUSPENDED' && me.status !== 'ARCHIVED',
    passes: passes.map((p) => ({ plan: p.plan, left: p.left, total: p.classesTotal, expiresAt: p.expiresAt?.toISOString() ?? null, batch: p.batch })),
  });
}
