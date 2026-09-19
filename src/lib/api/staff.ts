import { db } from '@/lib/db';
import { sessionUserFrom, type SessionUser } from '@/lib/auth';
import type { TenantContext } from '@/lib/tenant';
import { bearerUser } from './auth';

/**
 * A member of staff on the app: the same bearer token as a learner's,
 * with the roles, permissions and scope loaded so every check the web
 * admin makes applies unchanged. A learner's token is refused here.
 */
export async function apiStaff(request: Request): Promise<{ tenant: TenantContext; user: SessionUser } | null> {
  const who = await bearerUser(request);
  if (!who || who.user.kind !== 'STAFF') return null;
  const row = await db.user.findFirst({
    where: { id: who.user.id, organizationId: who.tenant.organizationId },
    include: {
      branchMemberships: true,
      roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!row) return null;
  return { tenant: who.tenant, user: sessionUserFrom(row) };
}
