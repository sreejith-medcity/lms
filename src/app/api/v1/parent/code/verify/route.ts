import { apiTenant } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { issueParentTokens } from '@/lib/api/parent';
import { checkOtp } from '@/lib/otp';
import { normaliseContact, maskContact } from '@/lib/parents';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** POST { contact, code, device? } → tokens. The refresh token is a parent session, revocable from the account page. */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  const body = await readJson(request);
  const contact = normaliseContact(str(body?.contact, 200));
  const code = str(body?.code, 12);
  if (!contact || !code) return fail('bad_request', 'Send contact and code.', 400);
  const checked = await checkOtp({ target: contact, purpose: 'parent', code });
  if (!checked.ok) return fail('bad_code', checked.error ?? 'That code is wrong or has expired.', 400);
  const tokens = await issueParentTokens(tenant.organizationId, contact, str(body?.device, 120) || null);
  await recordAudit({ organizationId: tenant.organizationId, actorId: null, action: 'parent.signed_in', entity: 'ParentSession', entityId: maskContact(contact), after: { via: 'app' } });
  return ok(tokens);
}
