import { apiTenant } from '@/lib/api/auth';
import { clientIp, fail, ok, readJson, str } from '@/lib/api/http';
import { requestSignInCode } from '@/lib/api/sign-in';

export const dynamic = 'force-dynamic';

/** POST { identifier } → a six digit code by SMS or email. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  if (!body) return fail('bad_json', 'Send JSON.', 400);
  const r = await requestSignInCode({ organizationId: tenant.organizationId, tenantId: tenant.tenantId, identifier: str(body.identifier), ip: clientIp(request) });
  if (!r.ok) return fail('cannot_send', r.message, r.retryAfter ? 429 : 400, r.retryAfter ? { retryAfter: r.retryAfter } : undefined);
  return ok({ sentTo: r.sentTo ?? null, message: r.message });
}
