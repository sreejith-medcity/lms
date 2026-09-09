'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { checkBands, DEFAULT_BANDS, parseBands, type Band } from '@/lib/grading';
import type { ActionState } from '@/server/courses';

/**
 * Grade scales.
 *
 * The validation is the feature. A gap between 79 and 80 is invisible until
 * somebody scores in it, and then it appears on a report card in front of a
 * parent rather than in front of whoever set the bands. So nothing that leaves
 * a gap, an overlap or a backwards band can be saved.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.preferences', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[grading]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function saveGradeScale(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) return { error: 'Give the scale a name.' };

    const grades = formData.getAll('grade').map(String);
    const mins = formData.getAll('minPercent').map(Number);
    const maxes = formData.getAll('maxPercent').map(Number);
    const points = formData.getAll('point').map(String);
    const labels = formData.getAll('bandLabel').map(String);

    const bands: Band[] = grades
      .map((grade, i) => ({
        grade: grade.trim(),
        minPercent: mins[i],
        maxPercent: maxes[i],
        point: points[i]?.trim() ? Number(points[i]) : undefined,
        label: labels[i]?.trim() || undefined,
      }))
      .filter((b) => b.grade && Number.isFinite(b.minPercent) && Number.isFinite(b.maxPercent));

    if (bands.length === 0) return { error: 'Add at least one band.' };

    const problems = checkBands(bands);
    if (problems.length > 0) {
      return { error: problems.map((p) => p.message).join(' ') };
    }

    const sorted = parseBands(bands);

    if (id) {
      const existing = await db.gradeScale.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Scale not found.' };

      await db.gradeScale.update({
        where: { id },
        data: { name, bands: sorted as unknown as Prisma.InputJsonValue },
      });
    } else {
      const count = await db.gradeScale.count({ where: { organizationId: tenant.organizationId } });

      await db.gradeScale.create({
        data: {
          organizationId: tenant.organizationId,
          name,
          bands: sorted as unknown as Prisma.InputJsonValue,
          // The first scale created is the one in use, since a scale nobody
          // switched on is a scale that silently does nothing.
          isActive: count === 0,
        },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'grading.updated' : 'grading.created',
      entity: 'GradeScale',
      entityId: id || 'new',
      after: { name, bands: sorted.length },
    });

    revalidatePath('/admin/settings/grading');
    return { ok: true, message: `${name} saved, ${sorted.length} bands, no gaps.` };
  } catch (err) {
    return fail(err);
  }
}

export async function useGradeScale(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const scale = await db.gradeScale.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, name: true },
    });
    if (!scale) return { error: 'Scale not found.' };

    await db.$transaction([
      db.gradeScale.updateMany({
        where: { organizationId: tenant.organizationId },
        data: { isActive: false },
      }),
      db.gradeScale.update({ where: { id }, data: { isActive: true } }),
    ]);

    revalidatePath('/admin/settings/grading');
    revalidatePath('/learn', 'layout');
    return { ok: true, message: `Results now show ${scale.name} grades.` };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteGradeScale(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const scale = await db.gradeScale.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, isActive: true },
    });
    if (!scale) return { error: 'Scale not found.' };
    if (scale.isActive) return { error: 'This is the scale in use. Switch to another one first.' };

    await db.gradeScale.delete({ where: { id } });

    revalidatePath('/admin/settings/grading');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Puts the standard bands in, for an academy that does not want to type seven rows. */
export async function seedDefaultScale(): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const count = await db.gradeScale.count({ where: { organizationId: tenant.organizationId } });

    await db.gradeScale.create({
      data: {
        organizationId: tenant.organizationId,
        name: 'Standard',
        bands: DEFAULT_BANDS as unknown as Prisma.InputJsonValue,
        isActive: count === 0,
      },
    });

    revalidatePath('/admin/settings/grading');
    return { ok: true, message: 'Seven bands from A+ to F, covering 0 to 100 with no gaps.' };
  } catch (err) {
    return fail(err);
  }
}
