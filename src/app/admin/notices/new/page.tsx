import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { staffScope } from '@/lib/scope';
import { Card, PageHeader } from '@/components/ui';
import { NoticeForm } from '../form';
import { audienceOptions } from '../data';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New notice', robots: { index: false, follow: false } };

export default async function NewNoticePage() {
  const tenant = await requireTenant();
  const user = await requireStaff('announcements.manage_announcements', 'edit');
  const scope = await staffScope(user);
  const options = await audienceOptions(tenant.organizationId, scope);

  return (
    <div>
      <PageHeader title="New notice" description="Saved as a draft first. You see who it reaches before it goes." />
      <Card>
        <NoticeForm
          values={{ kind: 'GENERAL', title: '', body: '', everyone: false, branchIds: [], batchIds: [], learners: [], toParents: true, toLearners: false, meetingAt: '', meetingEndsAt: '', venue: '', link: '', instructions: '', correction: false }}
          branches={options.branches}
          batches={options.batches}
          canReachAll={scope.kind === 'all'}
          timezone={tenant.timezone}
        />
      </Card>
    </div>
  );
}
