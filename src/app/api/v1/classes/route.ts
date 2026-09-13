import { bearerUser } from '@/lib/api/auth';
import { upcomingClasses } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const days = Math.max(1, Math.min(60, Number(new URL(request.url).searchParams.get('days') ?? 14) || 14));
  return ok(await upcomingClasses(ctx.tenant, ctx.user, days));
}
