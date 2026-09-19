import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { db } from '@/lib/db';
import { childrenOf } from '@/lib/parent-session';
import { NOTICE_KINDS } from '@/lib/notices';

export const dynamic = 'force-dynamic';

/** GET → one notice, only when it reached this contact and a child it names is still linked. Marks it read. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const orgId = ctx.tenant.organizationId;
  const row = await db.parentNotification.findFirst({ where: { organizationId: orgId, contact: ctx.parent.contact, noticeId: id }, select: { id: true, learnerId: true, learnerIds: true, readAt: true } });
  if (!row) return fail('not_found', 'This notice was not sent to you.', 404);
  const children = await childrenOf(orgId, ctx.parent.contact);
  const ids = row.learnerIds.length ? row.learnerIds : [row.learnerId];
  const named = children.filter((c) => ids.includes(c.id));
  if (named.length === 0) return fail('access_removed', 'This notice is about a child who is no longer on your account.', 404);
  const notice = await db.notice.findFirst({
    where: { id, organizationId: orgId, status: { in: ['PUBLISHED', 'WITHDRAWN'] } },
    include: { supersedes: { select: { id: true, version: true } }, supersededBy: { where: { status: 'PUBLISHED' }, select: { id: true, version: true } } },
  });
  if (!notice) return fail('not_found', 'This notice is no longer available.', 404);
  if (!row.readAt) await db.parentNotification.updateMany({ where: { id: row.id, organizationId: orgId }, data: { readAt: new Date() } });
  const files = notice.assetIds.length ? await db.asset.findMany({ where: { organizationId: orgId, id: { in: notice.assetIds } }, select: { id: true, name: true } }) : [];
  return ok({
    id: notice.id,
    kind: notice.kind,
    category: NOTICE_KINDS.find((k) => k.key === notice.kind)?.category ?? 'Notice',
    title: notice.title,
    body: notice.body,
    status: notice.status,
    version: notice.version,
    correctionNote: notice.correctionNote,
    earlierVersionId: notice.supersedes?.id ?? null,
    correctedById: notice.supersededBy[0]?.id ?? null,
    publishedAt: notice.publishedAt?.toISOString() ?? null,
    withdrawnAt: notice.withdrawnAt?.toISOString() ?? null,
    withdrawReason: notice.withdrawReason,
    meeting: notice.meetingAt ? { at: notice.meetingAt.toISOString(), endsAt: notice.meetingEndsAt?.toISOString() ?? null, venue: notice.venue, link: notice.link, instructions: notice.instructions } : null,
    children: named.map((c) => ({ id: c.id, name: c.name })),
    files: files.map((f) => ({ id: f.id, name: f.name, path: `/api/assets/${f.id}` })),
  });
}
