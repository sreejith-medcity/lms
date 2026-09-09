import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';
import type { PermissionSet } from '@/lib/permissions';

export const SESSION_COOKIE = 'mlms_session';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  kind: 'LEARNER' | 'STAFF';
  organizationId: string;
  branchIds: string[];
  roleIds: string[];
  permissions: PermissionSet;
  restrictBatchAccess: boolean;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.authSession.findUnique({
    where: { sessionToken: token },
    include: {
      user: {
        include: {
          branchMemberships: true,
          roleAssignments: {
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) return null;

  // A session cookie is only valid on the tenant that issued it. Without this,
  // a cookie set on one academy's hostname is accepted on another's, because
  // sibling subdomains share a cookie domain. Null tenant means the platform
  // control plane, which has no organisation of its own.
  const tenant = await getTenantContext();
  if (tenant && session.user.organizationId !== tenant.organizationId) return null;

  // A suspended, archived or soft-deleted account keeps its cookie until the
  // session expires; the session has to stop honouring it immediately. Other
  // statuses (registered, on leave, completed) can still sign in.
  if (session.user.deletedAt) return null;
  if (session.user.status === 'SUSPENDED' || session.user.status === 'ARCHIVED') return null;

  const permissions: PermissionSet = {};
  let restrictBatchAccess = false;

  for (const assignment of session.user.roleAssignments) {
    if (assignment.role.restrictBatchAccess) restrictBatchAccess = true;
    for (const rp of assignment.role.permissions) {
      const key = rp.permission.key;
      const existing = permissions[key] ?? { view: false, edit: false, delete: false };
      permissions[key] = {
        view: existing.view || rp.canView,
        edit: existing.edit || rp.canEdit,
        delete: existing.delete || rp.canDelete,
      };
    }
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    kind: session.user.kind as 'LEARNER' | 'STAFF',
    organizationId: session.user.organizationId,
    branchIds: session.user.branchMemberships.map((m) => m.branchId),
    roleIds: session.user.roleAssignments.map((r) => r.roleId),
    permissions,
    restrictBatchAccess,
  };
});

export async function requireStaff(permissionKey?: string, action: 'view' | 'edit' | 'delete' = 'view') {
  const user = await getSessionUser();
  if (!user || user.kind !== 'STAFF') throw new Error('UNAUTHORIZED');
  if (permissionKey) {
    const entry = user.permissions[permissionKey];
    if (!entry?.[action]) throw new Error('FORBIDDEN');
  }
  return user;
}

export async function currentHost() {
  return (await headers()).get('host') ?? '';
}
