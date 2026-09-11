'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { reportConversion } from '@/lib/analytics-server';
import { attributionJson, conversionHints, requestAttribution } from '@/lib/attribution-server';
import { getTenantContext } from '@/lib/tenant';
import { happened } from '@/lib/events';
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
export type EnquiryState = ActionState & { eventId?: string };

export async function submitEnquiry(_prev: EnquiryState, formData: FormData): Promise<EnquiryState> {
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

    const attribution = await requestAttribution();

    const lead = await db.lead.create({
      data: {
        organizationId: tenant.organizationId,
        name: d.name,
        email: d.email || null,
        phone: d.phone || null,
        message: d.message || null,
        interestedIn: d.interestedIn || null,
        source: 'WEB',
        campaign: attribution?.last.utm_campaign ?? null,
        attribution: attributionJson(attribution),
      },
      select: { id: true },
    });

    await happened({
      organizationId: tenant.organizationId,
      key: 'lead.created',
      leadId: lead.id,
      subjectId: lead.id,
      data: { leadId: lead.id, name: d.name, email: d.email || null, phone: d.phone || null, interestedIn: d.interestedIn || null, source: 'WEB' },
    });

    // Told to the ad platforms from here as well as from the browser, keyed
    // on the lead id so the two copies count once.
    reportConversion({
      organizationId: tenant.organizationId,
      event: 'lead',
      eventId: lead.id,
      email: d.email || null,
      phone: d.phone || null,
      ...conversionHints(attribution),
    }).catch(() => undefined);

    return { ok: true, message: 'Thanks. Someone from the team will get back to you.', eventId: lead.id };
  } catch (err) {
    console.error('[enquiry]', err instanceof Error ? err.message : err);
    return { error: 'We could not record that just now. Please try again.' };
  }
}
