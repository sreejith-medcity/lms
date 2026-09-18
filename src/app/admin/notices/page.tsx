import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { isScoped, scopeNote, staffScope } from '@/lib/scope';
import { NOTICE_KINDS } from '@/lib/notices';
import { formatDateTime } from '@/lib/clock';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { STATUS_LABEL, STATUS_TONE } from './data';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices', robots: { index: false, follow: false } };

/**
 * Every notice the office has drafted or sent, newest first. A Branch Head
 * sees the ones aimed inside their branch and the academy-wide ones; Head
 * Office sees all. Teachers do not reach this page: the permission is the
 * announcements one.
 */
export default async function NoticesPage() {
  const tenant = await requireTenant();
  const user = await requireStaff('announcements.manage_announcements', 'view');
  const scope = await staffScope(user);

  const notices = await db.notice.findMany({
    where: {
      organizationId: tenant.organizationId,
      ...(isScoped(scope) && scope.kind !== 'all'
        ? { OR: [{ everyone: true }, { branchIds: { hasSome: scope.branchIds } }, { createdById: user.id }, ...(scope.kind === 'batches' ? [{ batchIds: { hasSome: scope.batchIds } }] : [])] }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 100,
    select: { id: true, kind: true, title: true, status: true, version: true, supersedesId: true, supersededById: true, publishedAt: true, updatedAt: true, parentCount: true, learnerCount: true, everyone: true, branchIds: true, batchIds: true, learnerIds: true, toParents: true, toLearners: true },
  });

  const note = scopeNote(scope);

  return (
    <div>
      <PageHeader
        title="Notices"
        description={`What the office tells parents: meetings, holidays, exam dates, fees. Drafted, counted, published once; corrected as a new version. ${note ?? ''}`.trim()}
        action={<LinkButton href="/admin/notices/new">New notice</LinkButton>}
      />

      {notices.length === 0 ? (
        <EmptyState title="No notices yet" hint="A parent-teacher meeting, a holiday, an exam date. Write it once, see who it reaches, publish." />
      ) : (
        <div className="space-y-2">
          {notices.map((n) => {
            const audience = n.everyone
              ? 'everyone'
              : [n.branchIds.length ? `${n.branchIds.length} branch${n.branchIds.length === 1 ? '' : 'es'}` : '', n.batchIds.length ? `${n.batchIds.length} batch${n.batchIds.length === 1 ? '' : 'es'}` : '', n.learnerIds.length ? `${n.learnerIds.length} learner${n.learnerIds.length === 1 ? '' : 's'}` : '']
                  .filter(Boolean)
                  .join(', ');
            return (
              <Card key={n.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/notices/${n.id}`} className="font-medium hover:underline">
                        {n.title}
                      </Link>
                      <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                      {n.supersededById && <Badge tone="neutral">superseded</Badge>}
                      {n.version > 1 && <Badge tone="warn">correction, v{n.version}</Badge>}
                    </div>
                    <p className="t-small faint mt-1">
                      {NOTICE_KINDS.find((k) => k.key === n.kind)?.label ?? n.kind} · to {audience}
                      {n.toParents && n.toLearners ? ', parents and learners' : n.toLearners ? ', learners' : ', parents'}
                      {n.status === 'PUBLISHED' && n.publishedAt ? ` · published ${formatDateTime(n.publishedAt, tenant.timezone)} · ${n.parentCount} parents${n.toLearners ? `, ${n.learnerCount} learners` : ''}` : ` · edited ${formatDateTime(n.updatedAt, tenant.timezone)}`}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
