'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { parseRules, whereFor, type Rule, type SegmentRules } from '@/lib/segments';
import type { ActionState } from '@/server/courses';

/**
 * Segments.
 *
 * A dynamic segment stores its rules and nothing else: the members are worked
 * out when somebody asks. A static one stores a list of ids, for the cases
 * where the rule is "these forty people I picked".
 *
 * `memberCount` is a cache for the list screen, refreshed whenever the segment
 * is recomputed. It is never the number a campaign uses: that one is worked out
 * at the moment the campaign is prepared, because a count from last Tuesday is
 * how somebody messages people who have since unsubscribed.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('marketing.segments', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[segments]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const segmentShape = z.object({
  name: z.string().trim().min(2, 'Give the segment a name').max(120),
  type: z.enum(['DYNAMIC', 'STATIC']),
  match: z.enum(['ALL', 'ANY']),
});

function readRules(formData: FormData): Rule[] {
  const fields = formData.getAll('ruleField').map(String);
  const values = formData.getAll('ruleValue').map(String);

  return fields
    .map((field, i) => ({ field, value: values[i]?.trim() || undefined }))
    .filter((r) => r.field)
    .slice(0, 10) as Rule[];
}

export async function saveSegment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const parsed = segmentShape.safeParse({
      name: formData.get('name'),
      type: formData.get('type') || 'DYNAMIC',
      match: formData.get('match') || 'ALL',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const rules: SegmentRules =
      d.type === 'STATIC'
        ? { match: 'ALL', rules: [] }
        : { match: d.match, rules: readRules(formData) };

    if (d.type === 'DYNAMIC' && rules.rules.length === 0) {
      return { error: 'A dynamic segment needs at least one condition, or it is just everybody.' };
    }

    const members =
      d.type === 'STATIC'
        ? formData.getAll('memberIds').map(String).filter(Boolean).slice(0, 20000)
        : [];

    const stored = { ...rules, members: d.type === 'STATIC' ? members : undefined };

    const count =
      d.type === 'STATIC'
        ? members.length
        : await db.user.count({ where: whereFor(tenant.organizationId, rules) });

    const data = {
      organizationId: tenant.organizationId,
      name: d.name,
      type: d.type,
      rules: stored as unknown as Prisma.InputJsonValue,
      memberCount: count,
      lastComputedAt: new Date(),
    };

    if (id) {
      const existing = await db.segment.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Segment not found.' };
      await db.segment.update({ where: { id }, data });
    } else {
      await db.segment.create({ data });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'segment.updated' : 'segment.created',
      entity: 'Segment',
      entityId: id || 'new',
      after: { name: d.name, type: d.type, count },
    });

    revalidatePath('/admin/segments');
    revalidatePath('/admin/campaigns');
    return {
      ok: true,
      message: `${d.name} matches ${count} ${count === 1 ? 'learner' : 'learners'} right now.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** Refreshes the cached count, and says whether it moved. */
export async function recomputeSegment(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const segment = await db.segment.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, name: true, type: true, rules: true, memberCount: true },
    });
    if (!segment) return { error: 'Segment not found.' };

    if (segment.type === 'STATIC') {
      return { ok: true, message: 'A static segment is a list, so there is nothing to recompute.' };
    }

    const count = await db.user.count({
      where: whereFor(tenant.organizationId, parseRules(segment.rules)),
    });

    await db.segment.update({
      where: { id },
      data: { memberCount: count, lastComputedAt: new Date() },
    });

    const moved = count - segment.memberCount;

    revalidatePath('/admin/segments');
    return {
      ok: true,
      message:
        moved === 0
          ? `Still ${count}.`
          : `${count} now, ${moved > 0 ? 'up' : 'down'} ${Math.abs(moved)} since it was last worked out.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSegment(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const segment = await db.segment.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!segment) return { error: 'Segment not found.' };

    const inUse = await db.campaign.count({
      where: { organizationId: tenant.organizationId, segmentId: `SEGMENT:${id}` },
    });
    if (inUse > 0) {
      return { error: `${inUse} campaigns target this segment. Change those first.` };
    }

    await db.segment.delete({ where: { id } });

    revalidatePath('/admin/segments');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
