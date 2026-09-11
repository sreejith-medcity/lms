import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';

/**
 * Scheduled campaigns become queued messages.
 *
 * A campaign was, until now, a list of people and a template that nothing
 * ever sent. On each scheduler run, every campaign that is due is handed to
 * the outbox in batches: one row per person, on the campaign's channel, with
 * the campaign's template named on the row so the drain uses that wording
 * and not the event's. Delivery, cost and failure are then the outbox's,
 * where every other message already lives.
 */

const BATCH = 200;

export interface CampaignSendResult {
  campaigns: number;
  handedOver: number;
  finished: number;
}

export async function sendDueCampaigns(organizationId: string): Promise<CampaignSendResult> {
  const result: CampaignSendResult = { campaigns: 0, handedOver: 0, finished: 0 };
  const now = new Date();

  const due = await db.campaign.findMany({
    where: {
      organizationId,
      status: { in: ['SCHEDULED', 'SENDING'] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    select: { id: true, name: true, channel: true, templateId: true, status: true },
    take: 10,
  });

  const organization = due.length ? await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }) : null;

  for (const campaign of due) {
    result.campaigns += 1;
    if (!campaign.templateId) {
      await db.campaign.update({ where: { id: campaign.id }, data: { status: 'FAILED' } });
      continue;
    }
    if (campaign.status === 'SCHEDULED') {
      await db.campaign.update({ where: { id: campaign.id }, data: { status: 'SENDING' } });
    }

    const waiting = await db.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: 'QUEUED' },
      select: { id: true, userId: true, target: true },
      take: BATCH,
    });

    if (waiting.length) {
      const people = await db.user.findMany({
        where: { organizationId, id: { in: waiting.map((r) => r.userId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true, email: true, phone: true },
      });
      const byId = new Map(people.map((p) => [p.id, p]));
      const userOf = (r: { userId: string | null }) => (r.userId ? byId.get(r.userId) : undefined);

      const queued = await queueNotifications({
        organizationId,
        eventKey: `campaign:${campaign.id}`,
        channels: [campaign.channel],
        templateKey: `tpl:${campaign.templateId}`,
        dedupeKey: `campaign:${campaign.id}`,
        recipients: waiting.map((r) => ({
          userId: r.userId,
          email: campaign.channel === 'EMAIL' ? r.target : (userOf(r)?.email ?? null),
          phone: campaign.channel === 'EMAIL' ? (userOf(r)?.phone ?? null) : r.target,
        })),
        context: { organization: organization?.name ?? '' },
        contextFor: (person) => ({ name: (person.userId && byId.get(person.userId)?.name) || '' }),
      });
      await db.campaignRecipient.updateMany({
        where: { id: { in: waiting.map((r) => r.id) } },
        data: { status: 'SENT', sentAt: now },
      });
      result.handedOver += queued.queued;
    }

    const left = await db.campaignRecipient.count({ where: { campaignId: campaign.id, status: 'QUEUED' } });
    if (left === 0) {
      const sent = await db.campaignRecipient.count({ where: { campaignId: campaign.id, status: 'SENT' } });
      await db.campaign.update({ where: { id: campaign.id }, data: { status: 'SENT', sentCount: sent } });
      result.finished += 1;
    }
  }

  return result;
}
