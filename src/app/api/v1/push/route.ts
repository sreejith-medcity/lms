import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** POST { platform: 'android' | 'ios', token } keeps the phone's push token; DELETE { token } forgets it. */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const platform = str(body?.platform, 20).toLowerCase();
  const token = str(body?.token, 4096);
  if (!['android', 'ios'].includes(platform) || !token) return fail('missing', 'Send platform (android or ios) and the token.', 400);
  await db.deviceToken.upsert({
    where: { token },
    create: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id, platform, token },
    update: { userId: ctx.user.id, organizationId: ctx.tenant.organizationId, platform, lastSeenAt: new Date() },
  });
  return ok({ registered: true });
}

export async function DELETE(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const token = str(body?.token, 4096);
  if (token) await db.deviceToken.deleteMany({ where: { token, userId: ctx.user.id, organizationId: ctx.tenant.organizationId } });
  return ok({ removed: true });
}
