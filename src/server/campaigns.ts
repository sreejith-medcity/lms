'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { unknownVariables, variablesUsed, type AudienceKind } from '@/lib/templates';
import { parseRules, whereFor } from '@/lib/segments';
import type { ActionState } from '@/server/courses';

/**
 * Campaigns, composed and resolved here, sent in Phase 7.
 *
 * Preparing a campaign is the part with judgement in it: who is in the audience,
 * which of them can actually be reached on the chosen channel, and whether the
 * template refers to anything that cannot be filled in. All of that is decided
 * and written down now. Sending is the easy part and comes later.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('marketing.campaigns', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[campaigns]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Templates ----------------------------------------------------------------- */

const templateShape = z.object({
  name: z.string().trim().min(2, 'Give the template a name').max(120),
  channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5, 'Write the message').max(4000),
  eventKey: z.string().trim().max(60).optional(),
});

export async function saveTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const id = String(formData.get('id') ?? '');
    const parsed = templateShape.safeParse({
      name: formData.get('name'),
      channel: formData.get('channel') || 'EMAIL',
      subject: formData.get('subject') || undefined,
      body: formData.get('body'),
      eventKey: formData.get('eventKey') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const unknown = unknownVariables(`${d.subject ?? ''} ${d.body}`);
    if (unknown.length) {
      return {
        error: `Nothing can fill in ${unknown.map((u) => `{{${u}}}`).join(', ')}. Remove it or use one of the listed variables.`,
      };
    }

    if (d.channel === 'EMAIL' && !d.subject?.trim()) {
      return { error: 'An email needs a subject line.' };
    }

    const data = {
      organizationId: tenant.organizationId,
      name: d.name,
      channel: d.channel as $Enums.Channel,
      subject: d.subject || null,
      body: d.body,
      eventKey: d.eventKey || null,
      variables: variablesUsed(`${d.subject ?? ''} ${d.body}`),
    };

    if (id) {
      const existing = await db.messageTemplate.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Template not found.' };
      await db.messageTemplate.update({ where: { id }, data });
    } else {
      await db.messageTemplate.create({ data });
    }

    revalidatePath('/admin/templates');
    revalidatePath('/admin/campaigns');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const template = await db.messageTemplate.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { campaigns: true } } },
    });
    if (!template) return { error: 'Template not found.' };
    if (template._count.campaigns > 0) {
      return { error: 'A campaign is using this template. Change the campaign first.' };
    }

    await db.messageTemplate.delete({ where: { id } });

    revalidatePath('/admin/templates');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Campaigns ----------------------------------------------------------------- */

const campaignShape = z.object({
  name: z.string().trim().min(2, 'Give the campaign a name').max(120),
  channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP']),
  templateId: z.string().trim().min(1, 'Pick a template'),
  audience: z.enum(['ALL_LEARNERS', 'BATCH', 'COURSE', 'ABANDONED_CART', 'INACTIVE_30D', 'SEGMENT']),
  audienceId: z.string().trim().optional(),
  scheduledAt: z.string().optional(),
});

export async function saveCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = campaignShape.safeParse({
      name: formData.get('name'),
      channel: formData.get('channel') || 'EMAIL',
      templateId: formData.get('templateId'),
      audience: formData.get('audience') || 'ALL_LEARNERS',
      audienceId: formData.get('audienceId') || undefined,
      scheduledAt: formData.get('scheduledAt') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const template = await db.messageTemplate.findFirst({
      where: { id: d.templateId, organizationId: tenant.organizationId },
      select: { id: true, channel: true },
    });
    if (!template) return { error: 'That template does not exist.' };
    if (template.channel !== d.channel) {
      return { error: 'The template is written for a different channel.' };
    }

    if (
      (d.audience === 'BATCH' || d.audience === 'COURSE' || d.audience === 'SEGMENT') &&
      !d.audienceId
    ) {
      return { error: 'Choose which one.' };
    }

    const campaign = await db.campaign.create({
      data: {
        organizationId: tenant.organizationId,
        name: d.name,
        channel: d.channel as $Enums.Channel,
        templateId: template.id,
        // The audience is kept on the campaign until segments exist in Phase 4.
        segmentId: d.audienceId ? `${d.audience}:${d.audienceId}` : d.audience,
        status: 'DRAFT',
        sendMode: d.scheduledAt ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null,
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'campaign.created',
      entity: 'Campaign',
      entityId: campaign.id,
      after: { name: d.name, channel: d.channel, audience: d.audience },
    });

    revalidatePath('/admin/campaigns');
    return { ok: true, message: 'Draft saved. Work out the audience next.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Resolve the audience into named recipients.
 *
 * Deliberately a separate press from creating the campaign: somebody should see
 * how many people this is about to reach, and on which addresses, before it is
 * scheduled. People with no address on the chosen channel are counted and
 * excluded rather than silently dropped.
 */
export async function prepareCampaign(campaignId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: tenant.organizationId },
      select: { id: true, channel: true, segmentId: true, status: true },
    });
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      return { error: 'This campaign is past the point where the audience can change.' };
    }

    const [kind, id] = (campaign.segmentId ?? 'ALL_LEARNERS').split(':') as [
      AudienceKind | 'SEGMENT',
      string?,
    ];

    const base = {
      organizationId: tenant.organizationId,
      kind: 'LEARNER' as const,
      deletedAt: null,
    };

    // A segment is worked out now rather than trusting its cached count: a
    // number from last Tuesday is how somebody messages people who have since
    // stopped matching.
    let segmentWhere: Awaited<ReturnType<typeof whereFor>> | null = null;
    let staticMembers: string[] | null = null;

    if (kind === 'SEGMENT' && id) {
      const segment = await db.segment.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { type: true, rules: true },
      });
      if (!segment) return { error: 'That segment no longer exists.' };

      if (segment.type === 'STATIC') {
        const stored = segment.rules as { members?: unknown };
        staticMembers = Array.isArray(stored?.members) ? stored.members.map(String) : [];
      } else {
        segmentWhere = whereFor(tenant.organizationId, parseRules(segment.rules));
      }
    }

    const where = segmentWhere
      ? segmentWhere
      : staticMembers
        ? { ...base, id: { in: staticMembers } }
        : kind === 'BATCH'
        ? { ...base, enrollments: { some: { batchId: id } } }
        : kind === 'COURSE'
          ? { ...base, enrollments: { some: { productId: id } } }
          : kind === 'ABANDONED_CART'
            ? { ...base, carts: { some: { status: 'ABANDONED' as const } } }
            : kind === 'INACTIVE_30D'
              ? {
                  ...base,
                  enrollments: {
                    some: {
                      lastActivityAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
                    },
                  },
                }
              : base;

    const people = await db.user.findMany({
      where,
      select: { id: true, email: true, phone: true },
      take: 20000,
    });

    const address = (person: { email: string | null; phone: string | null }) =>
      campaign.channel === 'EMAIL'
        ? person.email
        : campaign.channel === 'SMS' || campaign.channel === 'WHATSAPP'
          ? person.phone
          : null;

    const reachable = people
      .map((p) => ({ userId: p.id, target: address(p) ?? (campaign.channel === 'PUSH' || campaign.channel === 'IN_APP' ? p.id : null) }))
      .filter((p): p is { userId: string; target: string } => Boolean(p.target));

    await db.$transaction([
      db.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } }),
      db.campaignRecipient.createMany({
        data: reachable.map((r) => ({
          campaignId: campaign.id,
          userId: r.userId,
          target: r.target,
          status: 'QUEUED',
        })),
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'campaign.prepared',
      entity: 'Campaign',
      entityId: campaign.id,
      after: { audience: kind, resolved: people.length, reachable: reachable.length },
    });

    revalidatePath('/admin/campaigns');

    const unreachable = people.length - reachable.length;
    return {
      ok: true,
      message:
        reachable.length === 0
          ? 'Nobody in that audience can be reached on this channel.'
          : `${reachable.length} people queued${unreachable > 0 ? `, ${unreachable} left out with no address on this channel` : ''}. Nothing sends until a provider is connected.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setCampaignStatus(
  campaignId: string,
  status: $Enums.CampaignStatus,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: tenant.organizationId },
      select: { id: true, _count: { select: { recipients: true } } },
    });
    if (!campaign) return { error: 'Campaign not found.' };

    if (status === 'SCHEDULED' && campaign._count.recipients === 0) {
      return { error: 'Work out the audience first, so you can see who this reaches.' };
    }

    await db.campaign.update({ where: { id: campaignId }, data: { status } });

    revalidatePath('/admin/campaigns');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCampaign(campaignId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: tenant.organizationId },
      select: { id: true, sentCount: true },
    });
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.sentCount > 0) {
      return { error: 'This campaign has been sent, so it stays on the record.' };
    }

    await db.campaign.delete({ where: { id: campaignId } });

    revalidatePath('/admin/campaigns');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
