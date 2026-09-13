import { db } from '@/lib/db';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { STATUS_LABEL, categoryLabel, replyProblem, statusAfterMessage } from '@/lib/help-desk';

export const dynamic = 'force-dynamic';

async function load(organizationId: string, userId: string, id: string) {
  return db.helpTicket.findFirst({
    where: { id, organizationId, userId },
    select: { id: true, subject: true, category: true, status: true, createdAt: true, messages: { orderBy: { createdAt: 'asc' }, select: { id: true, fromStaff: true, body: true, attachmentIds: true, createdAt: true, authorId: true } } },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const t = await load(ctx.tenant.organizationId, ctx.user.id, id);
  if (!t) return fail('not_found', 'Ticket not found.', 404);
  const authorIds = Array.from(new Set(t.messages.map((m) => m.authorId).filter((x): x is string => Boolean(x))));
  const authors = await db.user.findMany({ where: { organizationId: ctx.tenant.organizationId, id: { in: authorIds } }, select: { id: true, name: true } });
  const names = new Map(authors.map((a) => [a.id, a.name]));
  return ok({
    id: t.id, subject: t.subject, category: t.category, categoryLabel: categoryLabel(t.category), status: t.status, statusLabel: STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] ?? t.status, openedAt: t.createdAt.toISOString(),
    messages: t.messages.map((m) => ({ id: m.id, fromStaff: m.fromStaff, author: m.authorId ? names.get(m.authorId) ?? null : null, body: m.body, attachments: m.attachmentIds.map((a) => `/api/assets/${a}?download=1`), at: m.createdAt.toISOString() })),
  });
}

/** POST { body } → a reply from the learner; a resolved ticket reopens. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const t = await db.helpTicket.findFirst({ where: { id, organizationId: ctx.tenant.organizationId, userId: ctx.user.id }, select: { id: true, status: true } });
  if (!t) return fail('not_found', 'Ticket not found.', 404);
  if (t.status === 'CLOSED') return fail('closed', 'This ticket is closed. Open a new one.', 409);
  const body = await readJson(request);
  const text = str(body?.body, 5000);
  const problem = replyProblem(text);
  if (problem) return fail('invalid', problem, 400);
  await db.helpTicket.update({ where: { id: t.id }, data: { status: statusAfterMessage(t.status, false), lastMessageAt: new Date(), lastFromStaff: false, resolvedAt: null, messages: { create: { authorId: ctx.user.id, fromStaff: false, body: text } } } });
  return ok({ sent: true }, { status: 201 });
}
