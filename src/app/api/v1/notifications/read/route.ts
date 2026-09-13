import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** POST { id } marks one read; POST {} marks them all. */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const id = str(body?.id, 60);
  const r = await db.notificationLog.updateMany({
    where: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id, channel: 'IN_APP', status: 'SENT', ...(id ? { id } : {}) },
    data: { status: 'READ' },
  });
  return ok({ marked: r.count });
}
