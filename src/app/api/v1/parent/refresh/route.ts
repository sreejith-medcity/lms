import { apiTenant } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { refreshParentTokens } from '@/lib/api/parent';

export const dynamic = 'force-dynamic';

/** POST { refreshToken } → a fresh access token, while the parent session behind it lives. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  const tokens = await refreshParentTokens(tenant.organizationId, str(body?.refreshToken, 200));
  if (!tokens) return fail('expired', 'Sign in again with a fresh code.', 401);
  return ok(tokens);
}
