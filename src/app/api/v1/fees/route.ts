import { bearerUser } from '@/lib/api/auth';
import { feesSummary } from '@/lib/api/data';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** Plans, charges and receipts. Paying happens on the web: POST /auth/web with the webPath given here. */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  return ok(await feesSummary(ctx.tenant, ctx.user));
}
