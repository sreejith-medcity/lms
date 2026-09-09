import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { PERMISSION_GROUPS } from '@/lib/permissions';
import { Badge } from '@/components/ui';
import { PermissionMatrix } from './matrix';

export const dynamic = 'force-dynamic';

export default async function RoleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('settings.roles', 'view');

  const role = await db.role.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      name: true,
      description: true,
      isSystem: true,
      restrictBatchAccess: true,
      permissions: {
        select: {
          canView: true,
          canEdit: true,
          canDelete: true,
          permission: { select: { key: true } },
        },
      },
      _count: { select: { userAssignments: true } },
    },
  });
  if (!role) notFound();

  const current: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  for (const p of role.permissions) {
    current[p.permission.key] = { view: p.canView, edit: p.canEdit, delete: p.canDelete };
  }

  const groups = Object.entries(PERMISSION_GROUPS).map(([group, items]) => ({
    group,
    label: titleize(group),
    items: (items as readonly string[]).map((item) => ({
      key: `${group}.${item}`,
      label: titleize(item),
    })),
  }));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/settings/roles" className="t-small faint hover:underline">
            Roles
          </Link>
          <h2 className="t-title mt-1 flex items-center gap-2">
            {role.name}
            {role.isSystem && <Badge tone="neutral">built in</Badge>}
          </h2>
          {role.description && <p className="t-small muted mt-1">{role.description}</p>}
          <p className="t-small faint mt-1">
            {role._count.userAssignments}{' '}
            {role._count.userAssignments === 1 ? 'person holds' : 'people hold'} this role.
            {role._count.userAssignments > 0 &&
              ' Changes take effect on their next request, not at their next sign-in.'}
          </p>
        </div>
      </div>

      <PermissionMatrix
        roleId={role.id}
        readOnly={role.isSystem}
        restrictBatchAccess={role.restrictBatchAccess}
        groups={groups}
        current={current}
      />
    </div>
  );
}

function titleize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
