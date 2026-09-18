import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { staffScope } from '@/lib/scope';
import { toLocalInput } from '@/lib/clock';
import { Card, PageHeader } from '@/components/ui';
import { NoticeForm } from '../../form';
import { audienceOptions } from '../../data';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit notice', robots: { index: false, follow: false } };

export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const user = await requireStaff('announcements.manage_announcements', 'edit');
  const scope = await staffScope(user);
  const notice = await db.notice.findFirst({ where: { id, organizationId: tenant.organizationId } });
  if (!notice) notFound();
  if (notice.status !== 'DRAFT') redirect(`/admin/notices/${notice.id}`);

  const [options, learners] = await Promise.all([
    audienceOptions(tenant.organizationId, scope),
    notice.learnerIds.length ? db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: notice.learnerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader title={notice.supersedesId ? `Correction, version ${notice.version}` : 'Edit draft'} description={notice.title} />
      <Card>
        <NoticeForm
          values={{
            id: notice.id,
            kind: notice.kind,
            title: notice.title,
            body: notice.body,
            everyone: notice.everyone,
            branchIds: notice.branchIds,
            batchIds: notice.batchIds,
            learners,
            toParents: notice.toParents,
            toLearners: notice.toLearners,
            meetingAt: toLocalInput(notice.meetingAt, tenant.timezone),
            meetingEndsAt: toLocalInput(notice.meetingEndsAt, tenant.timezone),
            venue: notice.venue ?? '',
            link: notice.link ?? '',
            instructions: notice.instructions ?? '',
            correction: notice.supersedesId !== null,
          }}
          branches={options.branches}
          batches={options.batches}
          canReachAll={scope.kind === 'all'}
          timezone={tenant.timezone}
        />
      </Card>
    </div>
  );
}
