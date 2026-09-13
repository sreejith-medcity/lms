import { bearerUser } from '@/lib/api/auth';
import { myCourses } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  return ok(await myCourses(ctx.tenant, ctx.user));
}
