'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { queueNotifications } from '@/lib/notify';
import { buildObjectKey, inferType, putObject, sanitiseFileName, storageConfigured } from '@/lib/storage';
import { isCategory, isOpenStatus, replyProblem, statusAfterMessage, ticketProblem, type HelpStatus } from '@/lib/help-desk';
import type { ActionState } from '@/server/courses';

/**
 * Help tickets. The learner opens one from Help in the portal and it lands
 * with their branch; the office replies from the queue. Each message moves
 * the ticket to whoever owes the next word.
 */

const STAFF_KEY = 'learner.learner_management';
const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[help-desk]', message);
  return { error: 'Something went wrong. Please try again.' };
}

function pickFiles(formData: FormData): File[] {
  return formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
}

async function storeFiles(organizationId: string, uploaderId: string, files: File[]): Promise<{ ids: string[]; error?: string }> {
  if (files.length === 0) return { ids: [] };
  if (files.length > MAX_FILES) return { ids: [], error: `Up to ${MAX_FILES} files on a message.` };
  if (files.some((f) => f.size > MAX_FILE_BYTES)) return { ids: [], error: 'Keep each file under 10 MB.' };
  if (!storageConfigured()) return { ids: [], error: 'File uploads are not switched on yet; describe it in words for now.' };
  const ids: string[] = [];
  for (const file of files) {
    const fileName = sanitiseFileName(file.name || 'file');
    const key = buildObjectKey(organizationId, fileName);
    const mime = file.type || 'application/octet-stream';
    await putObject(key, new Uint8Array(await file.arrayBuffer()), mime);
    const asset = await db.asset.create({
      data: { organizationId, name: `Help: ${fileName}`, fileName, type: inferType(fileName), storageKey: key, mimeType: mime, sizeBytes: BigInt(file.size), uploadedById: uploaderId, transcodeStatus: 'READY' },
      select: { id: true },
    });
    ids.push(asset.id);
  }
  return { ids };
}

/** The branch a learner's question goes to: their primary membership, else the branch of their latest enrolment. */
async function branchFor(organizationId: string, userId: string): Promise<string | null> {
  const membership = await db.branchMembership.findFirst({ where: { userId, branch: { organizationId } }, orderBy: { isPrimary: 'desc' }, select: { branchId: true } });
  if (membership) return membership.branchId;
  const enrolment = await db.enrollment.findFirst({ where: { organizationId, userId }, orderBy: { createdAt: 'desc' }, select: { branchId: true } });
  return enrolment?.branchId ?? null;
}

/* The learner's side ------------------------------------------------------- */

export async function openTicket(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let opened: string | null = null;
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const subject = String(formData.get('subject') ?? '').trim();
    const body = String(formData.get('body') ?? '').trim();
    const categoryRaw = String(formData.get('category') ?? 'OTHER');
    const category = isCategory(categoryRaw) ? categoryRaw : 'OTHER';
    const enrollmentId = String(formData.get('enrollmentId') ?? '') || null;
    const problem = ticketProblem({ subject, body });
    if (problem) return { error: problem };

    if (enrollmentId) {
      const own = await db.enrollment.findFirst({ where: { id: enrollmentId, organizationId: tenant.organizationId, userId: user.id }, select: { id: true } });
      if (!own) return { error: 'That course is not on your account.' };
    }

    const stored = await storeFiles(tenant.organizationId, user.id, pickFiles(formData));
    if (stored.error) return { error: stored.error };

    const branchId = await branchFor(tenant.organizationId, user.id);
    const ticket = await db.helpTicket.create({
      data: {
        organizationId: tenant.organizationId,
        userId: user.id,
        branchId,
        enrollmentId,
        subject,
        category,
        messages: { create: { authorId: user.id, fromStaff: false, body, attachmentIds: stored.ids } },
      },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'help.open', entity: 'HelpTicket', entityId: ticket.id, after: { subject, category } });
    opened = ticket.id;
  } catch (err) {
    return fail(err);
  }
  revalidatePath('/learn/help');
  redirect(`/learn/help/${opened}`);
}

export async function replyAsLearner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };
    const id = String(formData.get('ticketId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    const problem = replyProblem(body);
    if (problem) return { error: problem };

    const ticket = await db.helpTicket.findFirst({ where: { id, organizationId: tenant.organizationId, userId: user.id }, select: { id: true, status: true } });
    if (!ticket) return { error: 'Ticket not found.' };
    if (ticket.status === 'CLOSED') return { error: 'This ticket is closed. Open a new one and we will pick it up.' };

    const stored = await storeFiles(tenant.organizationId, user.id, pickFiles(formData));
    if (stored.error) return { error: stored.error };

    await db.helpTicket.update({
      where: { id: ticket.id },
      data: {
        status: statusAfterMessage(ticket.status, false),
        lastMessageAt: new Date(),
        lastFromStaff: false,
        resolvedAt: null,
        messages: { create: { authorId: user.id, fromStaff: false, body, attachmentIds: stored.ids } },
      },
    });
    revalidatePath(`/learn/help/${ticket.id}`);
    revalidatePath('/admin/help');
    return { ok: true, message: 'Sent.' };
  } catch (err) {
    return fail(err);
  }
}

/** The learner saying it is sorted. */
export async function closeOwnTicket(id: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };
    const changed = await db.helpTicket.updateMany({ where: { id, organizationId: tenant.organizationId, userId: user.id, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', resolvedAt: new Date() } });
    if (changed.count === 0) return { error: 'Ticket not found.' };
    revalidatePath(`/learn/help/${id}`);
    revalidatePath('/learn/help');
    return { ok: true, message: 'Closed. Thank you.' };
  } catch (err) {
    return fail(err);
  }
}

/* The office's side -------------------------------------------------------- */

async function staffTicket(id: string) {
  const [tenant, me] = await Promise.all([requireTenant(), requireStaff(STAFF_KEY, 'edit')]);
  const ticket = await db.helpTicket.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: { id: true, status: true, subject: true, userId: true, user: { select: { id: true, name: true, email: true, phone: true } } },
  });
  if (!ticket) throw new Error('NOT_FOUND');
  return { tenant, me, ticket };
}

export async function replyAsStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const id = String(formData.get('ticketId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    const resolve = formData.get('resolve') === 'on';
    const problem = replyProblem(body);
    if (problem) return { error: problem };
    const { tenant, me, ticket } = await staffTicket(id);

    const stored = await storeFiles(tenant.organizationId, me.id, pickFiles(formData));
    if (stored.error) return { error: stored.error };

    const status: HelpStatus = statusAfterMessage(ticket.status, true, resolve);
    await db.helpTicket.update({
      where: { id: ticket.id },
      data: {
        status,
        lastMessageAt: new Date(),
        lastFromStaff: true,
        assigneeId: me.id,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
        messages: { create: { authorId: me.id, fromStaff: true, body, attachmentIds: stored.ids } },
      },
    });

    await queueNotifications({
      organizationId: tenant.organizationId,
      eventKey: 'help.replied',
      recipients: [{ userId: ticket.user.id, email: ticket.user.email, phone: ticket.user.phone }],
      context: { name: ticket.user.name, subject: ticket.subject, staff: me.name, organization: tenant.name, url: `/learn/help/${ticket.id}`, outcome: status === 'RESOLVED' ? 'marked it resolved' : 'replied' },
    }).catch((err: unknown) => console.error('[help-desk] reply notice not queued', err));

    await recordAudit({ organizationId: tenant.organizationId, actorId: me.id, action: 'help.reply', entity: 'HelpTicket', entityId: ticket.id, after: { status } });
    revalidatePath(`/admin/help/${ticket.id}`);
    revalidatePath('/admin/help');
    revalidatePath(`/learn/help/${ticket.id}`);
    return { ok: true, message: status === 'RESOLVED' ? 'Sent and resolved.' : 'Sent.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Ticket not found.' };
    return fail(err);
  }
}

export async function setTicketStatus(id: string, status: HelpStatus): Promise<ActionState> {
  try {
    const { tenant, me, ticket } = await staffTicket(id);
    await db.helpTicket.update({ where: { id: ticket.id }, data: { status, resolvedAt: isOpenStatus(status) ? null : new Date() } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: me.id, action: 'help.status', entity: 'HelpTicket', entityId: ticket.id, after: { status } });
    revalidatePath(`/admin/help/${ticket.id}`);
    revalidatePath('/admin/help');
    revalidatePath(`/learn/help/${ticket.id}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Ticket not found.' };
    return fail(err);
  }
}

export async function setTicketPriority(id: string, high: boolean): Promise<ActionState> {
  try {
    const { ticket } = await staffTicket(id);
    await db.helpTicket.update({ where: { id: ticket.id }, data: { priority: high ? 'HIGH' : 'NORMAL' } });
    revalidatePath(`/admin/help/${ticket.id}`);
    revalidatePath('/admin/help');
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Ticket not found.' };
    return fail(err);
  }
}

export async function assignTicketToMe(id: string): Promise<ActionState> {
  try {
    const { me, ticket } = await staffTicket(id);
    await db.helpTicket.update({ where: { id: ticket.id }, data: { assigneeId: me.id } });
    revalidatePath(`/admin/help/${ticket.id}`);
    revalidatePath('/admin/help');
    return { ok: true, message: 'Yours.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Ticket not found.' };
    return fail(err);
  }
}
