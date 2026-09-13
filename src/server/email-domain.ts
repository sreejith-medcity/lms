'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { domainProblem, localPartProblem } from '@/lib/email-domain-rules';
import { checkDomainDns, mintDkimKeys, sealPrivateKey } from '@/lib/email-domain';
import type { ActionState } from '@/server/courses';

const PAGE = '/admin/settings/email-domain';

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('settings.integrations', 'edit')]);
  if (tenant.features.white_label === false) throw new Error('NOT_ON_PLAN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const m = err instanceof Error ? err.message : String(err);
  if (m === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (m === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (m === 'NOT_ON_PLAN') return { error: 'Sending from your own domain is not on your plan. See Settings, Billing.' };
  console.error('[email-domain]', m);
  return { error: 'Something went wrong.' };
}

/** Set or change the domain. A new domain gets a new key; the old records stop mattering. */
export async function saveEmailDomain(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const domain = String(formData.get('domain') ?? '').trim().toLowerCase();
    const fromLocal = String(formData.get('fromLocal') ?? 'noreply').trim().toLowerCase() || 'noreply';
    const fromName = String(formData.get('fromName') ?? '').trim() || null;
    const problem = domainProblem(domain) ?? localPartProblem(fromLocal);
    if (problem) return { error: problem };

    const existing = await db.emailDomain.findUnique({ where: { organizationId: tenant.organizationId }, select: { id: true, domain: true } });
    if (existing && existing.domain === domain) {
      await db.emailDomain.update({ where: { id: existing.id }, data: { fromLocal, fromName } });
    } else {
      const keys = mintDkimKeys();
      const data = { domain, fromLocal, fromName, dkimSelector: 'lms', dkimPublicKey: keys.publicKeyPem, dkimPrivateKey: sealPrivateKey(keys.privateKeyPem), status: 'PENDING', spfOk: false, dkimOk: false, dmarcOk: false, verifiedAt: null, lastCheckedAt: null, lastCheckNote: null };
      if (existing) await db.emailDomain.update({ where: { id: existing.id }, data });
      else await db.emailDomain.create({ data: { organizationId: tenant.organizationId, ...data } });
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'email_domain.save', entity: 'EmailDomain', entityId: domain, after: { fromLocal, fromName } });
    revalidatePath(PAGE);
    return { ok: true, message: existing?.domain === domain ? 'Saved.' : 'Domain set. Add the three DNS records, then check.' };
  } catch (err) {
    return fail(err);
  }
}

export async function checkEmailDomain(): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const check = await checkDomainDns(tenant.organizationId);
    if (!check) return { error: 'Set a domain first.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'email_domain.check', entity: 'EmailDomain', after: { ...check } });
    revalidatePath(PAGE);
    return { ok: true, message: check.note };
  } catch (err) {
    return fail(err);
  }
}

export async function removeEmailDomain(): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    await db.emailDomain.deleteMany({ where: { organizationId: tenant.organizationId } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'email_domain.remove', entity: 'EmailDomain' });
    revalidatePath(PAGE);
    return { ok: true, message: 'Removed. Mail goes out from the provider\'s address again.' };
  } catch (err) {
    return fail(err);
  }
}
