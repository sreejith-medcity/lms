import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card } from '@/components/ui';
import { BranchList, BranchForm } from './editors';

export const dynamic = 'force-dynamic';

export default async function BranchesSettings() {
  const tenant = await requireTenant();
  await requireStaff('settings.branches', 'view');

  const branches = await db.branch.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      state: true,
      addressLine: true,
      isActive: true,
      _count: { select: { batches: true, enrollments: true } },
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <BranchList branches={branches} />
      </div>
      <Card>
        <h2 className="t-heading">Add a branch</h2>
        <p className="t-small muted mt-1">
          Batches, enrolments and orders each belong to a branch, which is what makes
          branch-level reporting and branch-scoped staff access possible later.
        </p>
        <div className="mt-5">
          <BranchForm />
        </div>
      </Card>
    </div>
  );
}
