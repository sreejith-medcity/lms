import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { LEARNER_NAV_SETTING, resolveNav } from '@/lib/learner-nav';
import { Card } from '@/components/ui';
import { LearnerNavForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function LearnerPortalSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.preferences', 'view');
  const canEdit = me.permissions['settings.preferences']?.edit ?? false;

  const setting = await db.orgSetting.findUnique({
    where: {
      organizationId_key: { organizationId: tenant.organizationId, key: LEARNER_NAV_SETTING },
    },
    select: { value: true },
  });

  return (
    <Card>
      <h2 className="t-heading">The learner portal menu</h2>
      <p className="t-small muted mt-1 max-w-prose">
        What a learner sees across the top, and in what order. An academy selling one self-paced
        course does not want a community tab; one running eighteen branches of live classes may want
        it first.
      </p>
      <div className="mt-5">
        <LearnerNavForm
          current={resolveNav(setting?.value).map((i) => i.key)}
          canEdit={canEdit}
        />
      </div>
    </Card>
  );
}
