import { apiTenant } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { revokeParentToken } from '@/lib/api/parent';

export const dynamic = 'force-dynamic';

/** POST { refreshToken } → that device is signed out. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  await revokeParentToken(tenant.organizationId, str(body?.refreshToken, 200));
  return ok({ signedOut: true });
}
