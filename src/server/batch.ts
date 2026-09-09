'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { $Enums } from '@prisma/client';
import type { ActionState } from '@/server/courses';

/** The classroom: who teaches it, what it teaches, and who is in it. */

async function guard(permission = 'batches.batch_management', action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[batch]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function updateBatch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const startDate = String(formData.get('startDate') ?? '');
    const endDate = String(formData.get('endDate') ?? '');
    const capacityRaw = Number(formData.get('capacity') ?? 0);

    if (name.length < 2) return { error: 'Give the batch a name.' };

    const batch = await db.batch.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, courseId: true, _count: { select: { enrollments: true } } },
    });
    if (!batch) return { error: 'Batch not found.' };

    const capacity = Number.isFinite(capacityRaw) ? Math.max(0, Math.round(capacityRaw)) : 0;
    if (capacity > 0 && capacity < batch._count.enrollments) {
      return {
        error: `${batch._count.enrollments} learners are already in this batch, so the cap cannot be ${capacity}.`,
      };
    }

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (start && end && end < start) return { error: 'It ends before it starts.' };

    if (formData.get('isDefault') === 'on') {
      await db.batch.updateMany({
        where: { courseId: batch.courseId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    await db.batch.update({
      where: { id },
      data: {
        name,
        startDate: start,
        endDate: end,
        capacity: capacity || null,
        isDefault: formData.get('isDefault') === 'on',
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'batch.updated',
      entity: 'Batch',
      entityId: id,
      after: { name, capacity },
    });

    revalidatePath(`/admin/batches/${id}`);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setBatchStaff(
  batchId: string,
  userId: string,
  role: $Enums.BatchRole,
  on: boolean,
): Promise<ActionState> {
  try {
    const { tenant } = await guard('batches.batch_staff');

    const [batch, member] = await Promise.all([
      db.batch.findFirst({
        where: { id: batchId, organizationId: tenant.organizationId },
        select: { id: true },
      }),
      db.user.findFirst({
        where: { id: userId, organizationId: tenant.organizationId, kind: 'STAFF' },
        select: { id: true },
      }),
    ]);
    if (!batch || !member) return { error: 'Not found.' };

    if (on) {
      await db.batchStaff.upsert({
        where: { batchId_userId_role: { batchId, userId, role } },
        create: { batchId, userId, role },
        update: {},
      });
    } else {
      await db.batchStaff.deleteMany({ where: { batchId, userId, role } });
    }

    revalidatePath(`/admin/batches/${batchId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Which modules this batch actually teaches.
 *
 * A batch can run a subset of its course, which is how a four-week intensive and
 * a five-month programme share one curriculum. Empty means the whole course,
 * because that is what almost every batch wants and making people tick every box
 * to say "all of it" is a tax on the common case.
 */
export async function setBatchModules(
  batchId: string,
  moduleIds: string[],
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const batch = await db.batch.findFirst({
      where: { id: batchId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!batch) return { error: 'Batch not found.' };

    const valid = await db.module.findMany({
      where: { id: { in: moduleIds }, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true },
    });

    await db.$transaction([
      db.batchModule.deleteMany({ where: { batchId } }),
      db.batchModule.createMany({
        data: valid.map((m, i) => ({ batchId, moduleId: m.id, sortOrder: i })),
        skipDuplicates: true,
      }),
    ]);

    revalidatePath(`/admin/batches/${batchId}`);
    return {
      ok: true,
      message: valid.length === 0 ? 'This batch now teaches the whole course.' : 'Saved.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setEnrollmentStatus(
  enrollmentId: string,
  status: $Enums.EnrollmentStatus,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('batches.batch_learners');

    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, organizationId: tenant.organizationId },
      select: { id: true, batchId: true, status: true },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };

    await db.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'enrolment.status.changed',
      entity: 'Enrollment',
      entityId: enrollmentId,
      before: { status: enrollment.status },
      after: { status },
    });

    if (enrollment.batchId) revalidatePath(`/admin/batches/${enrollment.batchId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
