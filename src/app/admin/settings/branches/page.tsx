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
      kind: true,
      headUserId: true,
      deputyUserId: true,
      _count: { select: { batches: true, enrollments: true } },
    },
  });
  const staff = await db.user.findMany({
    where: { organizationId: tenant.organizationId, kind: 'STAFF', deletedAt: null, status: { notIn: ['SUSPENDED', 'ARCHIVED'] } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <BranchList branches={branches} staff={staff} />
      </div>
      <Card>
        <h2 className="t-heading">Add a branch</h2>
        <p className="t-small muted mt-1">
          Batches, enrolments and orders each belong to a branch. A Branch Head sees
          their own branch and approves its results; a virtual branch is where online
          batches live and works the same way.
        </p>
        <div className="mt-5">
          <BranchForm staff={staff} />
        </div>
      </Card>
    </div>
  );
}
