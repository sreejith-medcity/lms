import { apiTenant, revokeRefreshToken } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/** POST { refreshToken } → the device is signed out; the access token simply expires. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  const token = str(body?.refreshToken, 200);
  if (token) await revokeRefreshToken(tenant.organizationId, token);
  return ok({ signedOut: true });
}
