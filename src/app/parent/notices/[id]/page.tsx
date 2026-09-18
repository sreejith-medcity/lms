import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { childrenOf, requireParentSession } from '@/lib/parent-session';
import { NOTICE_KINDS, meetingLine } from '@/lib/notices';
import { formatDateTime, formatTime } from '@/lib/clock';
import { Badge, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notice', robots: { index: false, follow: false } };

/**
 * One notice, as the parent reads it. Only a notice that reached this
 * contact opens, and only while at least one child it names is still
 * linked. A corrected notice says what changed and links the version it
 * replaced; a withdrawn one says so and why.
 */
export default async function ParentNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireParentSession();
  const tz = tenant.timezone;

  const row = await db.parentNotification.findFirst({
    where: { organizationId: tenant.organizationId, contact: session.contact, noticeId: id },
    select: { id: true, learnerId: true, learnerIds: true, readAt: true },
  });
  if (!row) return <Gone reason="This notice was not sent to you, or the link has changed." />;
  const children = await childrenOf(tenant.organizationId, session.contact);
  const ids = row.learnerIds.length ? row.learnerIds : [row.learnerId];
  const named = children.filter((c) => ids.includes(c.id));
  if (named.length === 0) return <Gone reason="This notice is about a child who is no longer on your account." />;

  const notice = await db.notice.findFirst({
    where: { id, organizationId: tenant.organizationId, status: { in: ['PUBLISHED', 'WITHDRAWN'] } },
    include: { supersedes: { select: { id: true, version: true, publishedAt: true } }, supersededBy: { where: { status: 'PUBLISHED' }, select: { id: true, version: true, publishedAt: true } } },
  });
  if (!notice) return <Gone reason="This notice is no longer available." />;

  if (!row.readAt) await db.parentNotification.updateMany({ where: { id: row.id, organizationId: tenant.organizationId }, data: { readAt: new Date() } });

  const files = notice.assetIds.length ? await db.asset.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.assetIds } }, select: { id: true, name: true } }) : [];
  const meeting = meetingLine(notice, (d) => formatDateTime(d, tz), (d) => formatTime(d, tz));
  const replacedBy = notice.supersededBy[0];

  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Link href="/parent/notices" className="t-small faint hover:underline">
        Notices
      </Link>
      <div className="mt-3 space-y-4">
        {replacedBy && (
          <p className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
            This notice has been corrected.{' '}
            <Link href={`/parent/notices/${replacedBy.id}`} className="underline">
              Read the corrected version
            </Link>
            .
          </p>
        )}
        {notice.status === 'WITHDRAWN' && (
          <p className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--bad)' }}>
            Withdrawn by the academy{notice.withdrawnAt ? ` on ${formatDateTime(notice.withdrawnAt, tz)}` : ''}: {notice.withdrawReason}
          </p>
        )}
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{NOTICE_KINDS.find((k) => k.key === notice.kind)?.category ?? 'Notice'}</Badge>
            {notice.version > 1 && <Badge tone="warn">correction</Badge>}
            <span className="t-small faint">for {named.map((c) => c.name).join(', ')}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold">{notice.title}</h1>
          <p className="t-small faint mt-1">{notice.publishedAt ? formatDateTime(notice.publishedAt, tz) : ''} · {tenant.name}</p>
          {notice.correctionNote && (
            <p className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
              What changed: {notice.correctionNote}
              {notice.supersedes && (
                <>
                  {' '}
                  <Link href={`/parent/notices/${notice.supersedes.id}`} className="underline">
                    Earlier version
                  </Link>
                </>
              )}
            </p>
          )}
          {meeting && (
            <div className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm">
              <p className="font-medium">{meeting}</p>
              {notice.link && (
                <a href={notice.link} target="_blank" rel="noreferrer" className="underline">
                  Join online
                </a>
              )}
              {notice.instructions && <p className="t-small muted mt-1 whitespace-pre-wrap">{notice.instructions}</p>}
            </div>
          )}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{notice.body}</p>
          {files.length > 0 && (
            <ul className="mt-4 space-y-1 border-t pt-3">
              {files.map((f) => (
                <li key={f.id}>
                  <a href={`/api/assets/${f.id}`} target="_blank" rel="noreferrer" className="t-small underline">
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="t-small faint">Notices are one way. To reply, speak to the branch office.</p>
      </div>
    </div>
  );
}

function Gone({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Card>
        <h1 className="text-lg font-semibold">Nothing to show</h1>
        <p className="t-small muted mt-2">{reason}</p>
        <Link href="/parent/notices" className="mt-4 inline-flex h-10 items-center rounded-[var(--radius-sm)] border px-4 text-sm hover:bg-[var(--surface-2)]">
          Back to notices
        </Link>
      </Card>
    </div>
  );
}
