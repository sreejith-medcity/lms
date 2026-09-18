'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { parseProgram } from '@/lib/programs';
import type { ActionState } from '@/server/courses';

/**
 * Programs: the academic shape above a course. Head Office owns these
 * (settings permission); a Branch Head reads them through the batch and
 * the mark sheet.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('settings.preferences', action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[programs]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function saveProgram(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const id = String(formData.get('id') ?? '').trim();
    const parsed = parseProgram({
      name: String(formData.get('name') ?? ''),
      code: String(formData.get('code') ?? ''),
      description: String(formData.get('description') ?? ''),
      levels: String(formData.get('levels') ?? ''),
      skills: String(formData.get('skills') ?? ''),
      categories: String(formData.get('categories') ?? ''),
      passPercent: String(formData.get('passPercent') ?? ''),
      retestRule: String(formData.get('retestRule') ?? ''),
    });
    if (!parsed.ok) return { error: parsed.error };
    const v = parsed.value;

    const clash = await db.program.findFirst({
      where: { organizationId: tenant.organizationId, name: v.name, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (clash) return { error: `A program called ${v.name} already exists.` };

    const gradeScaleId = String(formData.get('gradeScaleId') ?? '').trim();
    const scale = gradeScaleId ? await db.gradeScale.findFirst({ where: { id: gradeScaleId, organizationId: tenant.organizationId }, select: { id: true } }) : null;

    const data = { ...v, gradeScaleId: scale?.id ?? null };
    let programId = id;
    if (id) {
      const owned = await db.program.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true } });
      if (!owned) return { error: 'Program not found.' };
      await db.program.update({ where: { id }, data });
    } else {
      const created = await db.program.create({ data: { ...data, organizationId: tenant.organizationId }, select: { id: true } });
      programId = created.id;
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'program.updated' : 'program.created',
      entity: 'Program',
      entityId: programId,
      after: { name: v.name, levels: v.levels.length, skills: v.skills.length, categories: v.assessmentCategories.length, passPercent: v.passPercent, retestRule: v.retestRule },
    });
    revalidatePath('/admin/settings/programs');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setProgramActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const owned = await db.program.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, name: true } });
    if (!owned) return { error: 'Program not found.' };
    await db.program.update({ where: { id }, data: { isActive } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'program.reactivated' : 'program.retired', entity: 'Program', entityId: id, after: { name: owned.name } });
    revalidatePath('/admin/settings/programs');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Which program a course belongs to; null takes it out of any. */
export async function setCourseProgram(courseId: string, programId: string | null): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([requireTenant(), requireStaff('courses.course_management', 'edit')]);
    const course = await db.course.findFirst({ where: { id: courseId, organizationId: tenant.organizationId }, select: { id: true, programId: true } });
    if (!course) return { error: 'Course not found.' };
    const program = programId ? await db.program.findFirst({ where: { id: programId, organizationId: tenant.organizationId }, select: { id: true, name: true } }) : null;
    if (programId && !program) return { error: 'Program not found.' };
    await db.course.update({ where: { id: course.id }, data: { programId: program?.id ?? null } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'course.program_set', entity: 'Course', entityId: course.id, before: { programId: course.programId }, after: { programId: program?.id ?? null, program: program?.name ?? null } });
    revalidatePath(`/admin/courses`);
    return { ok: true, message: program ? `Part of ${program.name}.` : 'Not part of any program.' };
  } catch (err) {
    return fail(err);
  }
}
