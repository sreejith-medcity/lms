import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card } from '@/components/ui';
import { NewRoleForm, DeleteRole } from './editors';

export const dynamic = 'force-dynamic';

export default async function RolesSettings() {
  const tenant = await requireTenant();
  await requireStaff('settings.roles', 'view');

  const roles = await db.role.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      restrictBatchAccess: true,
      _count: { select: { userAssignments: true, permissions: true } },
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-3">
        {roles.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/settings/roles/${r.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  {r.isSystem && <Badge tone="neutral">built in</Badge>}
                  {r.restrictBatchAccess && <Badge tone="warn">own batches only</Badge>}
                </div>
                {r.description && <p className="t-small muted mt-1">{r.description}</p>}
                <p className="t-small faint mt-1 tabular-nums">
                  {r._count.permissions} permission{r._count.permissions === 1 ? '' : 's'} ·{' '}
                  {r._count.userAssignments}{' '}
                  {r._count.userAssignments === 1 ? 'person' : 'people'}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/admin/settings/roles/${r.id}`}
                  className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2.5 text-[0.8125rem] font-medium"
                >
                  {r.isSystem ? 'View' : 'Edit'}
                </Link>
                {!r.isSystem && r._count.userAssignments === 0 && <DeleteRole id={r.id} />}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="t-heading">New role</h2>
        <p className="t-small muted mt-1">
          Built-in roles cannot be edited, so the usual move is to copy the closest one and
          adjust the copy. That way the original stays a known quantity.
        </p>
        <div className="mt-5">
          <NewRoleForm roles={roles.map((r) => ({ id: r.id, name: r.name }))} />
        </div>
      </Card>
    </div>
  );
}
