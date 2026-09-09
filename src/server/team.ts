'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { hashPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit';
import { allPermissionKeys } from '@/lib/permissions';
import type { ActionState } from '@/server/courses';

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.roles', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to manage the team.' };
  console.error('[team]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* People ------------------------------------------------------------------ */

const member = z.object({
  name: z.string().trim().min(2, 'Give them a name').max(120),
  email: z.string().trim().email('That email address does not look right'),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  roleId: z.string().min(1, 'Pick a role'),
  branchId: z.string().optional().or(z.literal('')),
});

/**
 * Adds a staff member with a one-time password.
 *
 * The password is generated here and shown once, rather than emailed, because
 * transactional email is not wired up yet and a system that silently fails to
 * deliver a credential is worse than one that hands it to you to pass on.
 * `mustResetPassword` forces a change at first sign-in either way.
 */
export async function addTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState & { temporaryPassword?: string }> {
  try {
    const { tenant, user } = await guard();

    const parsed = member.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const email = d.email.toLowerCase();

    const existing = await db.user.findFirst({
      where: { organizationId: tenant.organizationId, email, deletedAt: null },
      select: { id: true, kind: true },
    });
    if (existing) {
      return {
        error:
          existing.kind === 'STAFF'
            ? 'Someone with that email is already on the team.'
            : 'That email belongs to a learner account. Use a different address for staff.',
      };
    }

    const role = await db.role.findFirst({
      where: { id: d.roleId, organizationId: tenant.organizationId },
      select: { id: true, name: true },
    });
    if (!role) return { error: 'Role not found.' };

    // Readable enough to pass on over the phone, random enough to be safe.
    const temporaryPassword = `${randomBytes(6).toString('base64url')}-${randomBytes(2).toString('hex')}`;

    const created = await db.user.create({
      data: {
        organizationId: tenant.organizationId,
        name: d.name,
        email,
        phone: d.phone || null,
        kind: 'STAFF',
        status: 'ACTIVE',
        passwordHash: await hashPassword(temporaryPassword),
        mustResetPassword: true,
        roleAssignments: { create: { roleId: role.id } },
        ...(d.branchId
          ? { branchMemberships: { create: { branchId: d.branchId, isPrimary: true } } }
          : {}),
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'team.member.added',
      entity: 'User',
      entityId: created.id,
      after: { name: d.name, email, role: role.name },
    });

    revalidatePath('/admin/team');
    return {
      ok: true,
      temporaryPassword,
      message: `${d.name} can sign in with this one-time password. They will be asked to change it.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setMemberRole(userId: string, roleId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    if (userId === user.id) {
      return { error: 'You cannot change your own role. Ask another administrator.' };
    }

    const [member, role] = await Promise.all([
      db.user.findFirst({
        where: { id: userId, organizationId: tenant.organizationId, kind: 'STAFF' },
        select: { id: true, name: true },
      }),
      db.role.findFirst({
        where: { id: roleId, organizationId: tenant.organizationId },
        select: { id: true, name: true },
      }),
    ]);
    if (!member || !role) return { error: 'Not found.' };

    await db.$transaction([
      db.userRole.deleteMany({ where: { userId } }),
      db.userRole.create({ data: { userId, roleId } }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'team.role.changed',
      entity: 'User',
      entityId: userId,
      after: { role: role.name },
    });

    revalidatePath('/admin/team');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Suspension takes effect on the next request, not when their cookie expires. */
export async function setMemberStatus(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    if (userId === user.id) return { error: 'You cannot suspend yourself.' };

    await db.user.updateMany({
      where: { id: userId, organizationId: tenant.organizationId, kind: 'STAFF' },
      data: { status },
    });

    if (status === 'SUSPENDED') {
      await db.authSession.deleteMany({ where: { userId } });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: status === 'SUSPENDED' ? 'team.member.suspended' : 'team.member.restored',
      entity: 'User',
      entityId: userId,
    });

    revalidatePath('/admin/team');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Roles ------------------------------------------------------------------- */

export async function createRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    const copyFromId = String(formData.get('copyFromId') ?? '').trim();
    const restrictBatchAccess = formData.get('restrictBatchAccess') === 'on';

    if (name.length < 2) return { error: 'Give the role a name.' };

    const clash = await db.role.findFirst({
      where: { organizationId: tenant.organizationId, name },
      select: { id: true },
    });
    if (clash) return { error: `A role called ${name} already exists.` };

    const source = copyFromId
      ? await db.role.findFirst({
          where: { id: copyFromId, organizationId: tenant.organizationId },
          select: { permissions: true },
        })
      : null;

    await db.role.create({
      data: {
        organizationId: tenant.organizationId,
        name,
        description: description || null,
        restrictBatchAccess,
        permissions: source
          ? {
              create: source.permissions.map((p) => ({
                permissionId: p.permissionId,
                canView: p.canView,
                canEdit: p.canEdit,
                canDelete: p.canDelete,
              })),
            }
          : undefined,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'role.created',
      entity: 'Role',
      after: { name, copiedFrom: copyFromId || null },
    });

    revalidatePath('/admin/settings/roles');
    return { ok: true, message: 'Role created. Set its permissions next.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The whole permission matrix, saved in one go.
 *
 * Edit implies view and delete implies edit, enforced here rather than in the
 * form, because a role that can delete a payment but cannot see one is a
 * nonsense the server should not be willing to store.
 */
export async function saveRolePermissions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const roleId = String(formData.get('roleId') ?? '');
    const role = await db.role.findFirst({
      where: { id: roleId, organizationId: tenant.organizationId },
      select: { id: true, name: true, isSystem: true },
    });
    if (!role) return { error: 'Role not found.' };
    if (role.isSystem) {
      return { error: 'Built-in roles cannot be edited. Copy this role and change the copy.' };
    }

    const restrictBatchAccess = formData.get('restrictBatchAccess') === 'on';
    const keys = allPermissionKeys().map((p) => p.key);
    const permissions = await db.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });

    const rows = permissions.map((p) => {
      const canDelete = formData.get(`${p.key}:delete`) === 'on';
      const canEdit = canDelete || formData.get(`${p.key}:edit`) === 'on';
      const canView = canEdit || formData.get(`${p.key}:view`) === 'on';
      return { permissionId: p.id, canView, canEdit, canDelete };
    });

    await db.$transaction([
      db.role.update({ where: { id: role.id }, data: { restrictBatchAccess } }),
      db.rolePermission.deleteMany({ where: { roleId: role.id } }),
      db.rolePermission.createMany({
        data: rows
          .filter((r) => r.canView || r.canEdit || r.canDelete)
          .map((r) => ({ ...r, roleId: role.id })),
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'role.permissions.updated',
      entity: 'Role',
      entityId: role.id,
      after: { granted: rows.filter((r) => r.canView).length, restrictBatchAccess },
    });

    revalidatePath('/admin/settings/roles');
    return { ok: true, message: 'Saved. Anyone holding this role picks it up on their next request.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteRole(roleId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const role = await db.role.findFirst({
      where: { id: roleId, organizationId: tenant.organizationId },
      select: { id: true, name: true, isSystem: true, _count: { select: { userAssignments: true } } },
    });
    if (!role) return { error: 'Role not found.' };
    if (role.isSystem) return { error: 'Built-in roles cannot be deleted.' };
    if (role._count.userAssignments > 0) {
      return {
        error: `${role._count.userAssignments} person holds this role. Move them to another role first.`,
      };
    }

    await db.role.delete({ where: { id: role.id } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'role.deleted',
      entity: 'Role',
      entityId: role.id,
      before: { name: role.name },
    });

    revalidatePath('/admin/settings/roles');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
