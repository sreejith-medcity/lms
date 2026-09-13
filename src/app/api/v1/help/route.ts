import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { HELP_CATEGORIES, STATUS_LABEL, categoryLabel, isCategory, ticketProblem } from '@/lib/help-desk';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const rows = await db.helpTicket.findMany({
    where: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: { id: true, subject: true, category: true, status: true, lastMessageAt: true, lastFromStaff: true, createdAt: true, _count: { select: { messages: true } } },
  });
  return ok({
    categories: HELP_CATEGORIES.map((c) => ({ key: c.key, label: c.label, hint: c.hint })),
    tickets: rows.map((t) => ({ id: t.id, subject: t.subject, category: t.category, categoryLabel: categoryLabel(t.category), status: t.status, statusLabel: STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] ?? t.status, messages: t._count.messages, lastFromStaff: t.lastFromStaff, lastMessageAt: t.lastMessageAt.toISOString(), openedAt: t.createdAt.toISOString() })),
  });
}

/** POST { subject, body, category?, enrollmentId? } → the new ticket. Files go through the web for now. */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const subject = str(body?.subject, 140);
  const text = str(body?.body, 5000);
  const categoryRaw = str(body?.category, 20);
  const category = isCategory(categoryRaw) ? categoryRaw : 'OTHER';
  const enrollmentId = str(body?.enrollmentId, 60) || null;
  const problem = ticketProblem({ subject, body: text });
  if (problem) return fail('invalid', problem, 400);
  if (enrollmentId) {
    const own = await db.enrollment.findFirst({ where: { id: enrollmentId, organizationId: ctx.tenant.organizationId, userId: ctx.user.id }, select: { id: true } });
    if (!own) return fail('invalid', 'That course is not on your account.', 400);
  }
  const membership = await db.branchMembership.findFirst({ where: { userId: ctx.user.id, branch: { organizationId: ctx.tenant.organizationId } }, orderBy: { isPrimary: 'desc' }, select: { branchId: true } });
  const latest = membership ? null : await db.enrollment.findFirst({ where: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id }, orderBy: { createdAt: 'desc' }, select: { branchId: true } });
  const ticket = await db.helpTicket.create({
    data: { organizationId: ctx.tenant.organizationId, userId: ctx.user.id, branchId: membership?.branchId ?? latest?.branchId ?? null, enrollmentId, subject, category, messages: { create: { authorId: ctx.user.id, fromStaff: false, body: text } } },
    select: { id: true },
  });
  return ok({ id: ticket.id }, { status: 201 });
}
