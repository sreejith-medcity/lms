'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { learnerWhere, staffScope } from '@/lib/scope';
import { audienceLine, noticeActions, parentNoticeRow, parseNotice } from '@/lib/notices';
import { resolveAudience, type AudienceSpec } from '@/lib/notice-audience';
import { notifyParents } from '@/lib/parent-notify';
import { queueNotifications } from '@/lib/notify';
import { happened } from '@/lib/events';
import { fromLocalInput } from '@/lib/clock';
import type { ActionState } from '@/server/courses';

/**
 * Company notices.
 *
 * Drafted, previewed against the people it will reach, published once. The
 * audience is resolved by the same function for the preview and the
 * publish, so the number the office saw is the number that went. A
 * correction is a new version that supersedes the old and says so in the
 * inbox; a withdrawal leaves the record and marks it withdrawn. Nobody
 * replies to a notice and no teacher sends one: the permission is the
 * announcements one, which the Teacher role does not carry.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('announcements.manage_announcements', action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to send notices.' };
  console.error('[notices]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function formToRaw(formData: FormData, timezone: string): Record<string, unknown> {
  // The form types local wall-clock times; they are read in the academy's zone.
  const local = (key: string) => {
    const v = String(formData.get(key) ?? '').trim();
    if (!v) return '';
    const d = fromLocalInput(v, timezone);
    return d ? d.toISOString() : 'bad';
  };
  return {
    kind: formData.get('kind'),
    title: formData.get('title'),
    body: formData.get('body'),
    everyone: formData.get('everyone'),
    branchIds: formData.getAll('branchIds').map(String),
    batchIds: formData.getAll('batchIds').map(String),
    learnerIds: formData.getAll('learnerIds').map(String),
    toParents: formData.get('toParents') ?? 'off',
    toLearners: formData.get('toLearners'),
    meetingAt: local('meetingAt'),
    meetingEndsAt: local('meetingEndsAt'),
    venue: formData.get('venue'),
    link: formData.get('link'),
    instructions: formData.get('instructions'),
  };
}

/** Create or update a draft. Redirects to the notice on success. */
export async function saveNotice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let target: string | null = null;
  try {
    const { tenant, user } = await guard();
    const parsed = parseNotice(formToRaw(formData, tenant.timezone));
    if (!parsed.ok) return { error: parsed.error };
    const scope = await staffScope(user);
    const audience = await resolveAudience(tenant.organizationId, scope, parsed.value);
    if (!audience.ok) return { error: audience.error };

    const id = String(formData.get('id') ?? '');
    const v = parsed.value;
    if (id) {
      const existing = await db.notice.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, status: true } });
      if (!existing) return { error: 'Notice not found.' };
      if (!noticeActions(existing.status, false).edit) return { error: 'A published notice is not edited; send a correction instead.' };
      await db.notice.update({ where: { id: existing.id }, data: { ...v } });
      target = existing.id;
    } else {
      const created = await db.notice.create({ data: { organizationId: tenant.organizationId, ...v, createdById: user.id }, select: { id: true } });
      target = created.id;
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: id ? 'notice.updated' : 'notice.drafted', entity: 'Notice', entityId: target, after: { title: v.title, kind: v.kind } });
    revalidatePath('/admin/notices');
  } catch (err) {
    return fail(err);
  }
  redirect(`/admin/notices/${target}`);
}

export interface AudiencePreview {
  ok: boolean;
  line: string;
  parents: number;
  learners: number;
  sample: string[];
}

/** The count and a sample, before anything is sent. */
export async function previewNoticeAudience(spec: AudienceSpec & { toParents: boolean; toLearners: boolean }): Promise<AudiencePreview> {
  try {
    const { tenant, user } = await guard('view');
    const scope = await staffScope(user);
    const res = await resolveAudience(tenant.organizationId, scope, { everyone: Boolean(spec.everyone), branchIds: spec.branchIds ?? [], batchIds: spec.batchIds ?? [], learnerIds: spec.learnerIds ?? [] });
    if (!res.ok) return { ok: false, line: res.error, parents: 0, learners: 0, sample: [] };
    const a = res.audience;
    return { ok: true, line: audienceLine(a, spec), parents: a.parents.length, learners: a.learners.length, sample: a.learners.slice(0, 5).map((l) => l.name) };
  } catch (err) {
    return { ok: false, line: fail(err).error ?? 'Could not count.', parents: 0, learners: 0, sample: [] };
  }
}

/** Learners the sender may name, by name or registration number. */
export async function searchNoticeLearners(q: string): Promise<{ id: string; name: string; registrationNo: number | null }[]> {
  try {
    const { tenant, user } = await guard('view');
    const scope = await staffScope(user);
    const term = q.trim();
    if (term.length < 2) return [];
    const reg = /^\d+$/.test(term) ? Number(term) : null;
    return await db.user.findMany({
      where: {
        organizationId: tenant.organizationId,
        kind: 'LEARNER',
        deletedAt: null,
        ...learnerWhere(scope),
        OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(reg !== null ? [{ registrationNo: reg }] : [])],
      },
      orderBy: { name: 'asc' },
      take: 15,
      select: { id: true, name: true, registrationNo: true },
    });
  } catch {
    return [];
  }
}

export async function attachToNotice(noticeId: string, assetId: string, on: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId }, select: { id: true, status: true, assetIds: true } });
    if (!notice) return { error: 'Notice not found.' };
    if (!noticeActions(notice.status, false).edit) return { error: 'Files change only on a draft.' };
    const asset = await db.asset.findFirst({ where: { id: assetId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true } });
    if (!asset) return { error: 'File not found.' };
    const next = on ? Array.from(new Set([...notice.assetIds, asset.id])).slice(0, 5) : notice.assetIds.filter((a) => a !== asset.id);
    await db.notice.update({ where: { id: notice.id }, data: { assetIds: next } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: on ? 'notice.file_attached' : 'notice.file_removed', entity: 'Notice', entityId: notice.id, after: { assetId } });
    revalidatePath(`/admin/notices/${notice.id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function publishNotice(noticeId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId } });
    if (!notice) return { error: 'Notice not found.' };
    if (!noticeActions(notice.status, false).publish) return { error: 'This notice has already gone out.' };

    const res = await resolveAudience(tenant.organizationId, scope, notice);
    if (!res.ok) return { error: res.error };
    const a = res.audience;
    if ((notice.toParents ? a.parents.length : 0) + (notice.toLearners ? a.learners.length : 0) === 0) return { error: 'Nobody would receive this: no linked parent or active learner in that audience.' };

    const org = await db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } });
    const publishedAt = new Date();

    // The record first, so a crash mid-send leaves a published notice whose
    // page shows the count, never a sent notice that still says draft.
    await db.notice.update({
      where: { id: notice.id },
      data: { status: 'PUBLISHED', publishedAt, publishedById: user.id, parentCount: notice.toParents ? a.parents.length : 0, learnerCount: notice.toLearners ? a.learners.length : 0 },
    });
    if (notice.supersedesId) {
      await db.notice.updateMany({ where: { id: notice.supersedesId, organizationId: tenant.organizationId }, data: { supersededById: notice.id } });
    }

    let parentsTold = 0;
    if (notice.toParents) {
      const sent = await notifyParents({
        organizationId: tenant.organizationId,
        eventKey: 'notice.published',
        alerts: a.parents.map((p) => {
          const row = parentNoticeRow(notice, p.children);
          return {
            contact: p.contact,
            name: p.name,
            learnerId: p.children[0].id,
            learnerIds: p.children.map((c) => c.id),
            kind: 'notice.published',
            title: row.title,
            body: row.body,
            href: row.href,
            dedupeKey: `${row.dedupeKey}:${p.contact}`,
            noticeId: notice.id,
          };
        }),
        context: { title: notice.title, organization: org?.name ?? '' },
        pushBody: 'A notice from the academy. Open the parent view to read it.',
      });
      parentsTold = sent.written;
    }

    let learnersTold = 0;
    if (notice.toLearners && a.learners.length) {
      const learners = await db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: a.learners.map((l) => l.id) } }, select: { id: true, name: true, email: true, phone: true } });
      const q = await queueNotifications({
        organizationId: tenant.organizationId,
        eventKey: 'notice.published',
        recipients: learners.map((l) => ({ userId: l.id, email: l.email, phone: l.phone })),
        dedupeKey: `notice:${notice.id}`,
        context: { title: notice.title, organization: org?.name ?? '' },
        contextFor: (p) => ({ name: learners.find((l) => l.id === p.userId)?.name ?? 'there' }),
      });
      learnersTold = q.queued;
    }

    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'notice.published', entity: 'Notice', entityId: notice.id, after: { title: notice.title, parents: a.parents.length, learners: a.learners.length, version: notice.version, supersedes: notice.supersedesId } });
    await happened({ organizationId: tenant.organizationId, key: 'notice.published', subjectId: notice.id, data: { title: notice.title, kind: notice.kind, parents: String(parentsTold), learners: String(learnersTold) } });
    revalidatePath('/admin/notices');
    revalidatePath(`/admin/notices/${notice.id}`);
    return { ok: true, message: `Published to ${a.parents.length} parent${a.parents.length === 1 ? '' : 's'}${notice.toLearners ? ` and ${a.learners.length} learner${a.learners.length === 1 ? '' : 's'}` : ''}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function withdrawNotice(noticeId: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId }, select: { id: true, status: true, supersededById: true, title: true } });
    if (!notice) return { error: 'Notice not found.' };
    if (!noticeActions(notice.status, notice.supersededById !== null).withdraw) return { error: 'Only a current, published notice can be withdrawn.' };
    const why = reason.trim().slice(0, 300);
    if (why.length < 3) return { error: 'Say why it is withdrawn; parents who already read it will see the reason.' };
    await db.notice.update({ where: { id: notice.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnById: user.id, withdrawReason: why } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'notice.withdrawn', entity: 'Notice', entityId: notice.id, after: { title: notice.title, reason: why } });
    revalidatePath('/admin/notices');
    revalidatePath(`/admin/notices/${notice.id}`);
    return { ok: true, message: 'Withdrawn. The inbox entry now says so.' };
  } catch (err) {
    return fail(err);
  }
}

/** A correction: a new draft of the same notice, one version on, that will supersede this one when published. */
export async function correctNotice(noticeId: string): Promise<ActionState> {
  let target: string | null = null;
  try {
    const { tenant, user } = await guard();
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId } });
    if (!notice) return { error: 'Notice not found.' };
    if (!noticeActions(notice.status, notice.supersededById !== null).correct) return { error: 'Only a current, published notice can be corrected.' };
    const open = await db.notice.findFirst({ where: { organizationId: tenant.organizationId, supersedesId: notice.id }, select: { id: true } });
    if (open) {
      target = open.id;
    } else {
      const created = await db.notice.create({
        data: {
          organizationId: tenant.organizationId,
          kind: notice.kind,
          title: notice.title,
          body: notice.body,
          assetIds: notice.assetIds,
          everyone: notice.everyone,
          branchIds: notice.branchIds,
          batchIds: notice.batchIds,
          learnerIds: notice.learnerIds,
          toParents: notice.toParents,
          toLearners: notice.toLearners,
          meetingAt: notice.meetingAt,
          meetingEndsAt: notice.meetingEndsAt,
          venue: notice.venue,
          link: notice.link,
          instructions: notice.instructions,
          version: notice.version + 1,
          supersedesId: notice.id,
          createdById: user.id,
        },
        select: { id: true },
      });
      target = created.id;
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'notice.correction_drafted', entity: 'Notice', entityId: target, after: { supersedes: notice.id, version: notice.version + 1 } });
    }
  } catch (err) {
    return fail(err);
  }
  redirect(`/admin/notices/${target}/edit`);
}

export async function setCorrectionNote(noticeId: string, note: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId }, select: { id: true, status: true } });
    if (!notice || notice.status !== 'DRAFT') return { error: 'Only a draft takes a correction note.' };
    await db.notice.update({ where: { id: notice.id }, data: { correctionNote: note.trim().slice(0, 300) || null } });
    revalidatePath(`/admin/notices/${notice.id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function discardNoticeDraft(noticeId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const notice = await db.notice.findFirst({ where: { id: noticeId, organizationId: tenant.organizationId }, select: { id: true, status: true, title: true } });
    if (!notice) return { error: 'Notice not found.' };
    if (notice.status !== 'DRAFT') return { error: 'Only a draft can be discarded; withdraw a published notice instead.' };
    await db.notice.delete({ where: { id: notice.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'notice.discarded', entity: 'Notice', entityId: notice.id, after: { title: notice.title } });
    revalidatePath('/admin/notices');
  } catch (err) {
    return fail(err);
  }
  redirect('/admin/notices');
}
