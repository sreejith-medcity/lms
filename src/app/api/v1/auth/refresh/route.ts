import { apiTenant, rotateTokens } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** POST { refreshToken } → a new pair; the old refresh token dies. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  const token = str(body?.refreshToken, 200);
  if (!token) return fail('missing', 'Send the refresh token.', 400);
  const tokens = await rotateTokens(tenant.organizationId, token);
  if (!tokens) return fail('invalid_refresh', 'That refresh token is no longer valid. Sign in again.', 401);
  return ok(tokens);
}
