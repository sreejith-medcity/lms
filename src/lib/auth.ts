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
  /** A Branch Head or Academic Manager: only their branches. See `lib/scope.ts`. */
  restrictBranchAccess: boolean;
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

  return sessionUserFrom(session.user);
});

/** The rows a session user is built from: the account, its branches and its roles with permissions. */
export interface SessionUserRows {
  id: string;
  name: string;
  email: string | null;
  kind: string;
  organizationId: string;
  branchMemberships: { branchId: string }[];
  roleAssignments: { roleId: string; role: { restrictBatchAccess: boolean; restrictBranchAccess: boolean; permissions: { canView: boolean; canEdit: boolean; canDelete: boolean; permission: { key: string } }[] } }[];
}

/**
 * The permission set and scope flags folded across every role the
 * person holds. Shared by the cookie session and the app's bearer
 * token, so both doors decide "may this person" the same way.
 */
export function sessionUserFrom(user: SessionUserRows): SessionUser {
  const permissions: PermissionSet = {};
  let restrictBatchAccess = false;
  let restrictBranchAccess = false;

  for (const assignment of user.roleAssignments) {
    if (assignment.role.restrictBatchAccess) restrictBatchAccess = true;
    if (assignment.role.restrictBranchAccess) restrictBranchAccess = true;
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
    id: user.id,
    name: user.name,
    email: user.email,
    kind: user.kind as 'LEARNER' | 'STAFF',
    organizationId: user.organizationId,
    branchIds: user.branchMemberships.map((m) => m.branchId),
    roleIds: user.roleAssignments.map((r) => r.roleId),
    permissions,
    restrictBatchAccess,
    // Both flags set means the narrower one wins: a teacher who is also a
    // Branch Head still opens the batch view as a Branch Head elsewhere, but
    // a role that says "own batches only" is not widened by a second role.
    restrictBranchAccess: restrictBranchAccess && !restrictBatchAccess,
  };
}

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
