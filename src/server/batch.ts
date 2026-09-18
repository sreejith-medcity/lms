'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canSeeBatch, staffScope } from '@/lib/scope';
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
    const level = String(formData.get('level') ?? '').trim().slice(0, 60);
    const modeRaw = String(formData.get('mode') ?? 'IN_PERSON');
    const mode: $Enums.BatchMode = modeRaw === 'ONLINE' || modeRaw === 'HYBRID' ? modeRaw : 'IN_PERSON';

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
        level: level || null,
        mode,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'batch.updated',
      entity: 'Batch',
      entityId: id,
      after: { name, capacity, level: level || null, mode },
    });

    revalidatePath(`/admin/batches/${id}`);
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A teacher's assignment to a batch, with the dates it runs. Assigning
 * again with new dates replaces the dates; ending sets the end date and
 * leaves the row, so the batch keeps its record of who taught it. Access
 * follows the dates (see `lib/scope.ts`), so an end date in the past
 * removes the teacher's view of the batch on their next request and the
 * learners' marks and registers stay exactly where they are.
 */
export async function assignBatchStaff(input: {
  batchId: string;
  userId: string;
  role: $Enums.BatchRole;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
}): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('batches.batch_staff');
    const scope = await staffScope(user);

    const [batch, member] = await Promise.all([
      db.batch.findFirst({
        where: { id: input.batchId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, branchId: true, name: true },
      }),
      db.user.findFirst({
        where: { id: input.userId, organizationId: tenant.organizationId, kind: 'STAFF', deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);
    if (!batch || !member) return { error: 'Not found.' };
    if (!canSeeBatch(scope, batch)) return { error: 'That batch is outside your branch.' };

    const startsOn = input.startsOn ? new Date(input.startsOn) : null;
    const endsOn = input.endsOn ? new Date(input.endsOn) : null;
    if ((startsOn && Number.isNaN(startsOn.getTime())) || (endsOn && Number.isNaN(endsOn.getTime()))) return { error: 'Those dates do not read.' };
    if (startsOn && endsOn && endsOn < startsOn) return { error: 'It ends before it starts.' };

    const before = await db.batchStaff.findUnique({
      where: { batchId_userId_role: { batchId: batch.id, userId: member.id, role: input.role } },
      select: { startsOn: true, endsOn: true },
    });
    await db.batchStaff.upsert({
      where: { batchId_userId_role: { batchId: batch.id, userId: member.id, role: input.role } },
      create: { batchId: batch.id, userId: member.id, role: input.role, startsOn, endsOn, note: input.note?.trim().slice(0, 300) || null, assignedById: user.id },
      update: { startsOn, endsOn, note: input.note?.trim().slice(0, 300) || null, assignedById: user.id, assignedAt: new Date() },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: before ? 'batch.staff.redated' : 'batch.staff.assigned',
      entity: 'BatchStaff',
      entityId: batch.id,
      before: before ? { userId: member.id, name: member.name, role: input.role, startsOn: before.startsOn, endsOn: before.endsOn } : undefined,
      after: { userId: member.id, name: member.name, role: input.role, startsOn, endsOn, note: input.note?.trim() || null },
    });

    revalidatePath(`/admin/batches/${batch.id}`);
    revalidatePath('/admin/desk');
    return { ok: true, message: `${member.name} assigned.` };
  } catch (err) {
    return fail(err);
  }
}

export async function endBatchStaff(batchId: string, userId: string, role: $Enums.BatchRole, endsOn: string | null): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('batches.batch_staff');
    const scope = await staffScope(user);
    const batch = await db.batch.findFirst({ where: { id: batchId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true, branchId: true } });
    if (!batch) return { error: 'Not found.' };
    if (!canSeeBatch(scope, batch)) return { error: 'That batch is outside your branch.' };

    const row = await db.batchStaff.findUnique({ where: { batchId_userId_role: { batchId, userId, role } }, select: { startsOn: true, endsOn: true } });
    if (!row) return { error: 'No such assignment.' };
    // Ending "today" means the assignment still counts today and stops tomorrow.
    const end = endsOn ? new Date(endsOn) : new Date();
    if (Number.isNaN(end.getTime())) return { error: 'That date does not read.' };
    const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    if (row.startsOn && endDay < row.startsOn) return { error: 'It would end before it started.' };

    const member = await db.user.findFirst({ where: { id: userId, organizationId: tenant.organizationId }, select: { name: true } });
    await db.batchStaff.update({ where: { batchId_userId_role: { batchId, userId, role } }, data: { endsOn: endDay } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'batch.staff.ended',
      entity: 'BatchStaff',
      entityId: batchId,
      before: { userId, name: member?.name, role, startsOn: row.startsOn, endsOn: row.endsOn },
      after: { userId, name: member?.name, role, startsOn: row.startsOn, endsOn: endDay },
    });

    revalidatePath(`/admin/batches/${batchId}`);
    revalidatePath('/admin/desk');
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

/**
 * A learner moves to another batch of the same course. The enrolment row
 * is the same row after the move: its attendance, marks, homework and fee
 * instalments stay under it, so the history reads as one story rather
 * than a fresh start with the old batch's records orphaned. Attendance in
 * the old batch is not recounted against the new roster; the classes it
 * refers to stay the classes that were held.
 */
export async function moveEnrollment(enrollmentId: string, toBatchId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('batches.batch_learners');
    const scope = await staffScope(user);

    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, organizationId: tenant.organizationId },
      select: { id: true, batchId: true, branchId: true, productId: true, user: { select: { name: true } }, batch: { select: { id: true, name: true, branchId: true, courseId: true } } },
    });
    if (!enrollment) return { error: 'Enrolment not found.' };
    if (enrollment.batch && !canSeeBatch(scope, enrollment.batch)) return { error: 'That batch is outside your branch.' };

    const to = await db.batch.findFirst({
      where: { id: toBatchId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, name: true, branchId: true, courseId: true, capacity: true, _count: { select: { enrollments: { where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } } } } } },
    });
    if (!to) return { error: 'Batch not found.' };
    if (!canSeeBatch(scope, to)) return { error: 'The batch to move to is outside your branch.' };
    if (to.id === enrollment.batchId) return { error: 'Already in that batch.' };
    if (enrollment.batch && to.courseId !== enrollment.batch.courseId) return { error: 'A learner moves between batches of the same course. A different course is a new enrolment.' };
    if (to.capacity && to._count.enrollments >= to.capacity) return { error: `${to.name} is full (${to.capacity} seats).` };

    await db.enrollment.update({ where: { id: enrollment.id }, data: { batchId: to.id, branchId: to.branchId } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'enrolment.moved',
      entity: 'Enrollment',
      entityId: enrollment.id,
      before: { batchId: enrollment.batchId, batch: enrollment.batch?.name ?? null, branchId: enrollment.branchId },
      after: { batchId: to.id, batch: to.name, branchId: to.branchId, learner: enrollment.user.name },
    });

    if (enrollment.batchId) revalidatePath(`/admin/batches/${enrollment.batchId}`);
    revalidatePath(`/admin/batches/${to.id}`);
    return { ok: true, message: `${enrollment.user.name} is now in ${to.name}; earlier attendance, marks and fees stay on the record.` };
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
