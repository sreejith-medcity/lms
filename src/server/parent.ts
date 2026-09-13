'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import { sendOtp } from '@/lib/otp-delivery';
import { checkOtp } from '@/lib/otp';
import { settingBool } from '@/lib/settings/store';
import { contactProblem, maskContact, normaliseContact } from '@/lib/parents';
import { clearParentSession, issueParentSession } from '@/lib/parent-session';
import { recordAudit } from '@/lib/audit';

/**
 * A parent's way in. Two steps: the contact on the child's record, then the
 * code sent to it. The first step answers the same way whether or not any
 * learner names that contact, so the form cannot be used to find out who
 * studies here.
 */

export interface ParentCodeState {
  error?: string;
  sent?: boolean;
  sentTo?: string;
  contact?: string;
}

export async function requestParentCode(_prev: ParentCodeState, formData: FormData): Promise<ParentCodeState> {
  const raw = String(formData.get('contact') ?? '');
  const problem = contactProblem(raw);
  if (problem) return { error: problem };
  const contact = normaliseContact(raw);

  const tenant = await getTenantContext();
  if (!tenant) return { error: 'This hostname is not linked to an academy.' };
  if (!(await settingBool(tenant.organizationId, 'auth.parentPortal'))) {
    return { error: 'The parent view is not switched on at this academy.' };
  }

  const byEmail = contact.includes('@');
  const child = await db.user.findFirst({
    where: {
      organizationId: tenant.organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      learnerProfile: byEmail ? { parentEmail: { equals: contact, mode: 'insensitive' } } : { parentPhone: { endsWith: contact } },
    },
    select: { id: true },
  });

  // No match is not something the screen gets to learn.
  if (!child) return { sent: true, contact, sentTo: maskContact(contact) };

  const result = await sendOtp({ organizationId: tenant.organizationId, target: contact, purpose: 'parent', eventKey: 'account.otp' });
  if (!result.ok) return { error: result.error ?? 'Could not send a code just now.' };
  return { sent: true, contact, sentTo: result.sentTo ?? maskContact(contact) };
}

export async function signInParent(_prev: ParentCodeState, formData: FormData): Promise<ParentCodeState> {
  const contact = normaliseContact(String(formData.get('contact') ?? ''));
  const code = String(formData.get('code') ?? '').trim();
  if (!contact || !code) return { error: 'Enter the code that was sent to you.', sent: true, contact };

  const tenant = await getTenantContext();
  if (!tenant) return { error: 'This hostname is not linked to an academy.' };

  const checked = await checkOtp({ target: contact, purpose: 'parent', code });
  if (!checked.ok) return { error: checked.error ?? 'That code is wrong or has expired.', sent: true, contact };

  await issueParentSession(tenant.organizationId, contact);
  await recordAudit({ organizationId: tenant.organizationId, actorId: null, action: 'parent.signed_in', entity: 'ParentSession', entityId: maskContact(contact) });
  redirect('/parent');
}

export async function signOutParent(): Promise<void> {
  await clearParentSession();
  redirect('/parent/login');
}
