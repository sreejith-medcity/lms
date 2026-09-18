'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canSeeLearner, staffScope } from '@/lib/scope';
import { maskContact, normaliseContact } from '@/lib/parents';
import { settingNumber } from '@/lib/settings/store';
import type { ActionState } from '@/server/courses';

/**
 * A parent's link to a child, made and ended by the office. The parent
 * portal opens on these and on nothing else, so this file is where a
 * parent's access begins and ends.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('learner.learner_management', 'edit')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[parent-links]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function linkParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const learnerId = String(formData.get('learnerId') ?? '');
    const name = String(formData.get('name') ?? '').trim().slice(0, 120);
    const relationship = String(formData.get('relationship') ?? '').trim().slice(0, 40) || null;
    const raw = String(formData.get('contact') ?? '');
    const verified = formData.get('verified') === 'on';

    if (!name) return { error: 'Whose link is this? Give the parent’s name.' };
    const contact = normaliseContact(raw);
    if (!contact) return { error: 'That does not look like a mobile number or an email address.' };
    if (!verified) return { error: 'Tick the box once you have checked the contact against the learner’s file.' };

    const learner = await db.user.findFirst({
      where: { id: learnerId, organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      select: { id: true, name: true },
    });
    if (!learner) return { error: 'Learner not found.' };
    if (!(await canSeeLearner(await staffScope(user), tenant.organizationId, learner.id))) return { error: 'That learner is outside your branch.' };

    const existing = await db.parentLink.findFirst({ where: { organizationId: tenant.organizationId, learnerId: learner.id, contact }, select: { id: true, status: true } });
    if (existing?.status === 'ACTIVE') return { error: `${maskContact(contact)} is already linked to ${learner.name}.` };

    const limit = await parentsPerChild(tenant.organizationId);
    const active = await db.parentLink.count({ where: { organizationId: tenant.organizationId, learnerId: learner.id, status: 'ACTIVE' } });
    if (active >= limit) return { error: `${learner.name} already has ${limit} linked parent${limit === 1 ? '' : 's'}, which is the most the academy allows. Revoke one first.` };

    const data = { name, relationship, status: 'ACTIVE' as const, verifiedHow: 'staff', verifiedById: user.id, verifiedAt: new Date(), revokedAt: null, revokedById: null, revokedReason: null };
    const link = existing
      ? await db.parentLink.update({ where: { id: existing.id }, data, select: { id: true } })
      : await db.parentLink.create({ data: { organizationId: tenant.organizationId, learnerId: learner.id, contact, ...data }, select: { id: true } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: existing ? 'parent_link.relinked' : 'parent_link.created',
      entity: 'ParentLink',
      entityId: link.id,
      after: { learnerId: learner.id, learner: learner.name, contact: maskContact(contact), name, relationship },
    });

    revalidatePath(`/admin/learners/${learner.id}`);
    return { ok: true, message: `${name} can now sign in with ${maskContact(contact)} and see ${learner.name}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeParentLink(linkId: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const link = await db.parentLink.findFirst({
      where: { id: linkId, organizationId: tenant.organizationId },
      select: { id: true, learnerId: true, contact: true, name: true, status: true, learner: { select: { name: true } } },
    });
    if (!link) return { error: 'Link not found.' };
    if (!(await canSeeLearner(await staffScope(user), tenant.organizationId, link.learnerId))) return { error: 'That learner is outside your branch.' };
    if (link.status === 'REVOKED') return { ok: true };
    const why = reason.trim().slice(0, 300);
    if (!why) return { error: 'Say why, in a few words. It goes on the record.' };

    await db.parentLink.update({ where: { id: link.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id, revokedReason: why } });
    // A parent still signed in on their phone loses the child on their next
    // request, because the portal reads links, not sessions. When this was
    // the only child on the sign-in, the sign-in itself ends too.
    const otherChildren = await db.parentLink.count({ where: { organizationId: tenant.organizationId, contact: link.contact, status: 'ACTIVE' } });
    if (otherChildren === 0) await db.parentSession.deleteMany({ where: { organizationId: tenant.organizationId, contact: link.contact } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'parent_link.revoked',
      entity: 'ParentLink',
      entityId: link.id,
      after: { learnerId: link.learnerId, learner: link.learner.name, contact: maskContact(link.contact), name: link.name, reason: why },
    });

    revalidatePath(`/admin/learners/${link.learnerId}`);
    return { ok: true, message: `${link.name} no longer sees ${link.learner.name}.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Makes a link from the contact already on the learner's record. The file
 * is the academy's own record, so a link from it is marked "record" rather
 * than "staff", and the office can see which is which.
 */
export async function linkParentFromRecord(learnerId: string, contact: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const learner = await db.user.findFirst({
      where: { id: learnerId, organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      select: { id: true, name: true, learnerProfile: { select: { parentName: true, parentPhone: true, parentEmail: true } } },
    });
    if (!learner) return { error: 'Learner not found.' };
    if (!(await canSeeLearner(await staffScope(user), tenant.organizationId, learner.id))) return { error: 'That learner is outside your branch.' };
    const onFile = new Set([normaliseContact(learner.learnerProfile?.parentPhone ?? ''), normaliseContact(learner.learnerProfile?.parentEmail ?? '')].filter(Boolean));
    const wanted = normaliseContact(contact);
    if (!wanted || !onFile.has(wanted)) return { error: 'That contact is not on the learner’s record.' };

    const existing = await db.parentLink.findFirst({ where: { organizationId: tenant.organizationId, learnerId: learner.id, contact: wanted }, select: { id: true, status: true } });
    if (existing) return { error: existing.status === 'ACTIVE' ? 'Already linked.' : 'This contact was revoked; link it again by hand if that was a mistake.' };

    const limit = await parentsPerChild(tenant.organizationId);
    const active = await db.parentLink.count({ where: { organizationId: tenant.organizationId, learnerId: learner.id, status: 'ACTIVE' } });
    if (active >= limit) return { error: `${learner.name} already has ${limit} linked parent${limit === 1 ? '' : 's'}.` };

    const link = await db.parentLink.create({
      data: {
        organizationId: tenant.organizationId,
        learnerId: learner.id,
        contact: wanted,
        name: learner.learnerProfile?.parentName?.trim() || 'Parent',
        status: 'ACTIVE',
        verifiedHow: 'record',
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'parent_link.created', entity: 'ParentLink', entityId: link.id, after: { learnerId: learner.id, learner: learner.name, contact: maskContact(wanted), from: 'record' } });
    revalidatePath(`/admin/learners/${learner.id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

async function parentsPerChild(organizationId: string): Promise<number> {
  const n = await settingNumber(organizationId, 'auth.parentsPerChild');
  return Math.max(1, Math.min(4, Math.round(n || 2)));
}
