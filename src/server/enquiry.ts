'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

const enquiry = z.object({
  name: z.string().trim().min(2, 'Please tell us your name').max(120),
  email: z.string().trim().email('That email address does not look right').optional().or(z.literal('')),
  phone: z.string().trim().min(6, 'That phone number looks too short').max(20).optional().or(z.literal('')),
  interestedIn: z.string().trim().max(160).optional().or(z.literal('')),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  // Bots fill every field they find. A human never sees this one.
  website: z.string().max(0).optional().or(z.literal('')),
});

/**
 * The public enquiry form. It writes a real Lead, which is the same record the
 * admin pipeline will read, rather than sending an email into a void.
 */
export async function submitEnquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await getTenantContext();
    if (!tenant) return { error: 'This academy is not reachable right now.' };

    const parsed = enquiry.safeParse({
      name: formData.get('name'),
      email: formData.get('email') || '',
      phone: formData.get('phone') || '',
      interestedIn: formData.get('interestedIn') || '',
      message: formData.get('message') || '',
      website: formData.get('website') || '',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    if (d.website) return { ok: true }; // silently drop, so the bot learns nothing
    if (!d.email && !d.phone) {
      return { error: 'Leave an email address or a phone number so we can reply.' };
    }

    await db.lead.create({
      data: {
        organizationId: tenant.organizationId,
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        message: d.message || null,
        interestedIn: d.interestedIn || null,
        source: 'WEB',
      },
    });

    return { ok: true, message: 'Thanks. Someone from the team will get back to you.' };
  } catch (err) {
    console.error('[enquiry]', err instanceof Error ? err.message : err);
    return { error: 'We could not record that just now. Please try again.' };
  }
}
