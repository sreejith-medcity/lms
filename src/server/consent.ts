'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

/**
 * Saying no, and changing your mind.
 *
 * Two doors to the same three flags: the link at the bottom of a marketing
 * email, which needs no sign-in because the person clicking it may not
 * remember their password and must still be able to stop the messages; and
 * the account page, where a signed-in learner sets all three at once.
 */

type Channel = 'email' | 'sms' | 'whatsapp';

const column = (channel: Channel) =>
  channel === 'email' ? 'emailOptOut' : channel === 'sms' ? 'smsOptOut' : 'whatsappOptOut';

/** From the link in a message. The token is the only credential, and it only ever turns a channel off. */
export async function unsubscribeByToken(token: string, channel: string): Promise<ActionState> {
  const tenant = await requireTenant();
  const which: Channel = channel === 'sms' ? 'sms' : channel === 'whatsapp' ? 'whatsapp' : 'email';
  const person = await db.user.findFirst({
    where: { unsubscribeToken: token, organizationId: tenant.organizationId },
    select: { id: true },
  });
  if (!person) return { error: 'This link is not one we recognise. Sign in and change it under Account instead.' };
  await db.user.update({ where: { id: person.id }, data: { [column(which)]: true } });
  return { ok: true, message: `Done. No more promotional ${which === 'email' ? 'emails' : which === 'sms' ? 'SMS' : 'WhatsApp messages'} from us. Receipts, class reminders and sign-in codes still come.` };
}

/** From the account page: all three at once. */
export async function saveConsent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user || user.organizationId !== tenant.organizationId) return { error: 'Please sign in again.' };

  await db.user.update({
    where: { id: user.id },
    data: {
      emailOptOut: formData.get('email') !== 'on',
      smsOptOut: formData.get('sms') !== 'on',
      whatsappOptOut: formData.get('whatsapp') !== 'on',
    },
  });
  revalidatePath('/learn/account');
  return { ok: true, message: 'Saved.' };
}
