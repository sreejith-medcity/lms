import { apiTenant, issueTokens } from '@/lib/api/auth';
import { clientIp, fail, ok, readJson, str } from '@/lib/api/http';
import { signInWithPassword } from '@/lib/api/sign-in';

export const dynamic = 'force-dynamic';

/** POST { identifier, password, device? } → tokens. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  if (!body) return fail('bad_json', 'Send JSON.', 400);
  const r = await signInWithPassword({ organizationId: tenant.organizationId, tenantId: tenant.tenantId, identifier: str(body.identifier), password: typeof body.password === 'string' ? body.password : '', ip: clientIp(request) });
  if (!r.ok) return fail(r.code, r.message, r.code === 'too_many' ? 429 : 401, r.retryAfter ? { retryAfter: r.retryAfter } : undefined);
  const tokens = await issueTokens(tenant.organizationId, r.userId, r.kind, str(body.device, 120) || null);
  return ok(tokens);
}
