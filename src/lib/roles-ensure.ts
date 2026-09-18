import { db } from '@/lib/db';
import { allPermissionKeys } from '@/lib/permissions';
import { STANDARD_ROLES, roleGrants } from '@/lib/standard-roles';

/**
 * Adds any standard role the academy does not have yet, with its grants.
 * A role that already exists is left exactly as it is, permissions
 * included, because an academy may have tuned it. Safe to run on every
 * visit to the roles page; it does nothing once every role is there.
 */
export async function ensureStandardRoles(organizationId: string): Promise<string[]> {
  const existing = new Set((await db.role.findMany({ where: { organizationId }, select: { name: true } })).map((r) => r.name));
  const missing = STANDARD_ROLES.filter((d) => !existing.has(d.name));
  if (missing.length === 0) return [];

  // The permission catalogue may have grown since the academy was seeded.
  for (const p of allPermissionKeys()) {
    await db.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, label: p.label }, update: {} });
  }
  const allPerms = await db.permission.findMany({ select: { id: true, key: true } });

  for (const def of missing) {
    const role = await db.role.create({
      data: {
        organizationId,
        name: def.name,
        description: def.description,
        isSystem: true,
        restrictBatchAccess: def.restrictBatch,
        restrictBranchAccess: def.restrictBranch,
      },
      select: { id: true },
    });
    const rows = allPerms
      .map((perm) => ({ perm, grant: roleGrants(def, perm.key) }))
      .filter((x): x is { perm: { id: string; key: string }; grant: NonNullable<ReturnType<typeof roleGrants>> } => x.grant !== null)
      .map(({ perm, grant }) => ({ roleId: role.id, permissionId: perm.id, ...grant }));
    if (rows.length) await db.rolePermission.createMany({ data: rows, skipDuplicates: true });
  }
  return missing.map((d) => d.name);
}
