import { bearerParent } from '@/lib/api/parent';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** POST { id? } → mark one row read, or all of them. */
export async function POST(request: Request) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const id = str(body?.id, 100);
  const r = await db.parentNotification.updateMany({
    where: { organizationId: ctx.tenant.organizationId, contact: ctx.parent.contact, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  return ok({ marked: r.count });
}
