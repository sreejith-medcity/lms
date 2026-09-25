import { db } from '@/lib/db';
import type { ExamFormat } from '@/lib/exams/types';
import { settingBool } from '@/lib/settings/store';
import { happened } from '@/lib/events';
import { attributionJson, requestAttribution } from '@/lib/attribution-server';

/**
 * The free paper on the public test pages: one per level (or per test, where
 * a family has no levels), once per person, ever. Claiming it writes a SAMPLE
 * allowance of one paper and an enquiry under Leads, so the office sees who
 * tried which test and can follow up. A learner already studying with the
 * academy gets the paper but no lead.
 */

export type SampleOutcome = 'granted' | 'already-had' | 'off';

export async function sampleOn(organizationId: string): Promise<boolean> {
  return settingBool(organizationId, 'learning.testsFreeSample');
}

export async function claimSample(organizationId: string, userId: string, format: ExamFormat): Promise<SampleOutcome> {
  if (!(await sampleOn(organizationId))) return 'off';
  const had = await db.examAllowance.findFirst({
    where: { organizationId, userId, source: 'SAMPLE', familyCode: format.family, level: format.level },
    select: { id: true },
  });
  if (had) return 'already-had';

  const user = await db.user.findFirst({ where: { id: userId, organizationId }, select: { name: true, email: true, phone: true } });
  if (!user) return 'off';
  await db.examAllowance.create({
    data: { organizationId, userId, familyCode: format.family, level: format.level, tests: 1, source: 'SAMPLE', note: `Free paper from /tests/${format.slug}` },
  });

  const enrolled = await db.enrollment.count({ where: { organizationId, userId, status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } } });
  if (!enrolled) {
    const contact = [user.email ? { email: user.email } : null, user.phone ? { phone: user.phone } : null].filter(Boolean) as { email?: string; phone?: string }[];
    const existing = contact.length ? await db.lead.findFirst({ where: { organizationId, OR: contact }, select: { id: true } }) : null;
    if (!existing) {
      const attribution = await requestAttribution().catch(() => null);
      const lead = await db.lead.create({
        data: {
          organizationId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          message: `Took the free ${format.name} paper.`,
          interestedIn: format.name,
          source: 'WEB',
          campaign: attribution?.last.utm_campaign ?? null,
          attribution: attributionJson(attribution),
          convertedUserId: userId,
        },
        select: { id: true },
      });
      await happened({
        organizationId,
        key: 'lead.created',
        leadId: lead.id,
        subjectId: lead.id,
        data: { leadId: lead.id, name: user.name, email: user.email, phone: user.phone, interestedIn: format.name, source: 'WEB' },
      }).catch(() => undefined);
    }
  }
  return 'granted';
}
