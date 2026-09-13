import { bearerUser } from '@/lib/api/auth';
import { notificationList } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50) || 50;
  return ok(await notificationList(ctx.tenant, ctx.user, limit));
}
