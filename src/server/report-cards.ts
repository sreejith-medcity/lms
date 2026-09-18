'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { happened } from '@/lib/events';
import { queueNotifications } from '@/lib/notify';
import { fromLocalInput } from '@/lib/clock';
import { gatherReportCard } from '@/lib/report-card-data';
import type { ActionState } from '@/server/courses';

/**
 * Report cards: issued by the office for one enrolment, from the figures
 * as they stand, then sent to the learner and, where the academy holds a
 * parent's address, to the parent.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('learner.learner_management', action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[report-cards]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const shape = z.object({
  enrollmentId: z.string().min(1, 'Pick an enrolment.'),
  title: z.string().trim().min(2, 'Give the card a title.').max(120),
  periodFrom: z.string().trim().optional(),
  periodTo: z.string().trim().optional(),
  remark: z.string().trim().max(2000).optional(),
});

export async function issueReportCard(_prev: ActionState, formData: FormData): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard('edit');
    const parsed = shape.safeParse({
      enrollmentId: formData.get('enrollmentId'),
      title: formData.get('title') || 'Progress report',
      periodFrom: formData.get('periodFrom') || undefined,
      periodTo: formData.get('periodTo') || undefined,
      remark: formData.get('remark') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const from = d.periodFrom ? fromLocalInput(`${d.periodFrom}T00:00`, tenant.timezone) : null;
    const to = d.periodTo ? fromLocalInput(`${d.periodTo}T23:59`, tenant.timezone) : null;
    if (from && to && from > to) return { error: 'The period ends before it starts.' };

    const gathered = await gatherReportCard({ organizationId: tenant.organizationId, enrollmentId: d.enrollmentId, from, to, timezone: tenant.timezone });
    if (!gathered) return { error: 'That enrolment is not one of yours.' };

    const card = await db.reportCard.create({
      data: {
        organizationId: tenant.organizationId,
        enrollmentId: d.enrollmentId,
        userId: gathered.learner.id,
        title: d.title,
        periodFrom: from,
        periodTo: to,
        remark: d.remark || null,
        data: gathered.data as never,
        issuedById: user.id,
      },
      select: { id: true },
    });

    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_card.issued', entity: 'ReportCard', entityId: card.id, after: { learner: gathered.learner.id, title: d.title, overall: gathered.data.overall } });
    revalidatePath(`/admin/learners/${gathered.learner.id}`);
    revalidatePath('/learn');
    return { ok: true, id: card.id, message: 'Issued. Send it when you are happy with it.' };
  } catch (err) {
    return fail(err);
  }
}

/** To the learner, and to the parent on file. Once; a second press says so. */
export async function sendReportCard(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const card = await db.reportCard.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: {
        id: true,
        title: true,
        sentAt: true,
        userId: true,
        user: { select: { id: true, name: true, email: true, phone: true, parentLinks: { where: { status: 'ACTIVE' }, select: { name: true, contact: true } } } },
        enrollment: { select: { productId: true, product: { select: { title: true } } } },
      },
    });
    if (!card) return { error: 'Report card not found.' };
    if (card.sentAt) return { error: 'Already sent.' };

    // Every linked parent gets a copy: the links are who may see this
    // child, and a report card is the child's record in the post.
    const parents = card.user.parentLinks.map((l) => ({ name: l.name, email: l.contact.includes('@') ? l.contact : null, phone: l.contact.includes('@') ? null : l.contact }));
    const recipients: { userId: string | null; email: string | null; phone: string | null }[] = [
      { userId: card.user.id, email: card.user.email, phone: card.user.phone },
      ...parents.map((p) => ({ userId: null, email: p.email, phone: p.phone })),
    ];
    const parentName = (person: { email: string | null; phone: string | null }) => parents.find((p) => (p.email && p.email === person.email) || (p.phone && p.phone === person.phone))?.name || 'Parent';

    await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'report_card.issued',
      recipients,
      dedupeKey: `report_card:${card.id}`,
      context: { name: card.user.name, item: card.title, course: card.enrollment.product.title, url: `/api/report-cards/${card.id}/pdf`, attachReportCard: card.id },
      contextFor: (person): Record<string, string> => (person.userId ? {} : { name: parentName(person), learner: card.user.name }),
    });
    await happened({
      organizationId: tenant.organizationId,
      key: 'report_card.issued',
      userId: card.userId,
      subjectId: card.id,
      productId: card.enrollment.productId,
      data: { reportCardId: card.id, item: card.title, course: card.enrollment.product.title, toParent: parents.length > 0 },
    });
    await db.reportCard.update({ where: { id: card.id }, data: { sentAt: new Date() } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_card.sent', entity: 'ReportCard', entityId: card.id, after: { recipients: recipients.length } });
    revalidatePath(`/admin/learners/${card.userId}`);
    return { ok: true, message: recipients.length > 1 ? 'Queued for the learner and the parent.' : 'Queued for the learner. No parent contact is on file.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteReportCard(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const card = await db.reportCard.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, userId: true, sentAt: true } });
    if (!card) return { error: 'Report card not found.' };
    if (card.sentAt) return { error: 'It has been sent, so it stays on the record.' };
    await db.reportCard.delete({ where: { id: card.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_card.deleted', entity: 'ReportCard', entityId: card.id });
    revalidatePath(`/admin/learners/${card.userId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
