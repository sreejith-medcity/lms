import { apiTenant } from '@/lib/api/auth';
import { clientIp, fail, limited, ok, readJson, str } from '@/lib/api/http';
import { db } from '@/lib/db';
import { sendOtp } from '@/lib/otp-delivery';
import { settingBool } from '@/lib/settings/store';
import { contactProblem, maskContact, normaliseContact } from '@/lib/parents';
import { linkFromRecords } from '@/lib/parent-session';

export const dynamic = 'force-dynamic';

/**
 * POST { contact } → a code to the phone or email on the child's record.
 * Answers the same way whether or not any learner names that contact,
 * so the app cannot be used to find out who studies here.
 */
export async function POST(request: Request) {
  const tenant = await apiTenant();
  if (!tenant) return fail('no_academy', 'This hostname is not an academy.', 404);
  if (!(await settingBool(tenant.organizationId, 'auth.parentPortal'))) return fail('off', 'The parent view is not switched on at this academy.', 403);
  const body = await readJson(request);
  const raw = str(body?.contact, 200);
  const problem = contactProblem(raw);
  if (problem) return fail('bad_contact', problem, 400);
  const contact = normaliseContact(raw);
  if (limited(`parent-code:${clientIp(request)}`, 10, 10 * 60_000) || limited(`parent-code:${contact}`, 5, 10 * 60_000)) {
    return fail('slow_down', 'Too many codes asked for. Wait a few minutes.', 429, { retryAfter: 600 });
  }

  await linkFromRecords(tenant.organizationId, contact);
  const child = await db.parentLink.findFirst({ where: { organizationId: tenant.organizationId, contact, status: 'ACTIVE', learner: { deletedAt: null } }, select: { id: true } });
  if (!child) return ok({ sentTo: maskContact(contact), message: 'If that contact is on a learner\'s record, a code is on its way.' });

  const onScreen = await settingBool(tenant.organizationId, 'auth.parentCodeOnScreen');
  const result = await sendOtp({ organizationId: tenant.organizationId, target: contact, purpose: 'parent', eventKey: 'account.otp', showWhenUndeliverable: onScreen });
  if (!result.ok) return fail('cannot_send', result.error ?? 'Could not send a code just now.', 400);
  if (result.shownCode) {
    // The pilot switch: no provider could carry the code, so it is shown.
    return ok({ sentTo: result.sentTo ?? maskContact(contact), message: 'No message provider is connected yet, so the code is shown here for the pilot.', code: result.shownCode, shown: true });
  }
  return ok({ sentTo: result.sentTo ?? maskContact(contact), message: 'Code sent.' });
}
