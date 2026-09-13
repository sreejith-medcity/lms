import { apiTenant, issueTokens } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { signInWithCode } from '@/lib/api/sign-in';

export const dynamic = 'force-dynamic';

/** POST { identifier, code, device? } → tokens. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  if (!body) return fail('bad_json', 'Send JSON.', 400);
  const r = await signInWithCode({ organizationId: tenant.organizationId, identifier: str(body.identifier), code: str(body.code, 12) });
  if (!r.ok) return fail(r.code, r.message, 401);
  return ok(await issueTokens(tenant.organizationId, r.userId, r.kind, str(body.device, 120) || null));
}
