import { db } from '@/lib/db';
import { bearerParent } from '@/lib/api/parent';
import { fail, ok, readJson, str } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** POST { platform, token } keeps a parent's phone for push; DELETE { token } forgets it. */
export async function POST(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const platform = str(body?.platform, 20).toLowerCase();
  const token = str(body?.token, 4096);
  if (!['android', 'ios'].includes(platform) || !token) return fail('missing', 'Send platform (android or ios) and the token.', 400);
  await db.parentDeviceToken.upsert({
    where: { token },
    create: { organizationId: ctx.tenant.organizationId, contact: ctx.parent.contact, platform, token },
    update: { contact: ctx.parent.contact, organizationId: ctx.tenant.organizationId, platform, lastSeenAt: new Date() },
  });
  return ok({ registered: true });
}

export async function DELETE(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const token = str(body?.token, 4096);
  if (token) await db.parentDeviceToken.deleteMany({ where: { token, contact: ctx.parent.contact, organizationId: ctx.tenant.organizationId } });
  return ok({ removed: true });
}
