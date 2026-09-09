'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import type { ActionState } from '@/server/courses';

const MATERIAL_TYPES = [
  'VIDEO', 'AUDIO', 'PDF', 'YOUTUBE', 'IMAGE', 'DOC', 'SHEET', 'SLIDE',
  'TEXT_HTML', 'ZIP', 'SCORM', 'LINK_EMBED', 'EPUB', 'LIVE_SESSION', 'ASSESSMENT',
] as const;

export type MaterialTypeValue = (typeof MATERIAL_TYPES)[number];

async function guard(permission = 'module.module_library', action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[curriculum]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/** Confirms the course belongs to this tenant, and returns its internal course id. */
async function courseIdFor(productId: string, organizationId: string) {
  const product = await db.product.findFirst({
    where: { id: productId, organizationId, type: 'COURSE' },
    select: { course: { select: { id: true } } },
  });
  return product?.course?.id ?? null;
}

export async function addModule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const productId = String(formData.get('productId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const existingModuleId = String(formData.get('moduleId') ?? '').trim();

    const courseId = await courseIdFor(productId, tenant.organizationId);
    if (!courseId) return { error: 'Course not found.' };

    const count = await db.courseModule.count({ where: { courseId } });

    if (existingModuleId) {
      // Linking a module that already exists in the library, which is the point
      // of having a library: the same OET module serves many courses.
      const owned = await db.module.findFirst({
        where: { id: existingModuleId, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!owned) return { error: 'Module not found.' };

      await db.courseModule.upsert({
        where: { courseId_moduleId: { courseId, moduleId: existingModuleId } },
        create: { courseId, moduleId: existingModuleId, sortOrder: count },
        update: {},
      });
    } else {
      if (name.length < 2) return { error: 'Give the module a name.' };

      const created = await db.module.create({
        data: { organizationId: tenant.organizationId, name },
        select: { id: true },
      });

      await db.courseModule.create({
        data: { courseId, moduleId: created.id, sortOrder: count },
      });
    }

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function unlinkModule(productId: string, moduleId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.module_library', 'delete');
    const courseId = await courseIdFor(productId, tenant.organizationId);
    if (!courseId) return { error: 'Course not found.' };

    // Only the link is removed. The module stays in the library for other courses.
    await db.courseModule.deleteMany({ where: { courseId, moduleId } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const productId = String(formData.get('productId') ?? '');
    const moduleId = String(formData.get('moduleId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    if (title.length < 2) return { error: 'Give the section a title.' };

    const owned = await db.module.findFirst({
      where: { id: moduleId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!owned) return { error: 'Module not found.' };

    const count = await db.section.count({ where: { moduleId } });
    await db.section.create({ data: { moduleId, title, sortOrder: count } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const material = z.object({
  productId: z.string().min(1),
  sectionId: z.string().min(1),
  title: z.string().trim().min(2, 'Give the material a title').max(160),
  type: z.enum(MATERIAL_TYPES),
  externalUrl: z.string().trim().url('That does not look like a full URL').optional().or(z.literal('')),
  durationMinutes: z.coerce.number().min(0).optional(),
  isFreePreview: z.boolean(),
});

export async function addMaterial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const parsed = material.safeParse({
      productId: formData.get('productId'),
      sectionId: formData.get('sectionId'),
      title: formData.get('title'),
      type: formData.get('type'),
      externalUrl: formData.get('externalUrl') || '',
      durationMinutes: formData.get('durationMinutes') || undefined,
      isFreePreview: formData.get('isFreePreview') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const section = await db.section.findFirst({
      where: { id: d.sectionId, module: { organizationId: tenant.organizationId } },
      select: { id: true },
    });
    if (!section) return { error: 'Section not found.' };

    const needsUrl = d.type === 'YOUTUBE' || d.type === 'LINK_EMBED';
    if (needsUrl && !d.externalUrl) return { error: 'That material type needs a URL.' };

    const count = await db.material.count({ where: { sectionId: d.sectionId } });

    await db.material.create({
      data: {
        sectionId: d.sectionId,
        title: d.title,
        type: d.type,
        externalUrl: d.externalUrl || null,
        durationSeconds: d.durationMinutes ? Math.round(d.durationMinutes * 60) : null,
        isFreePreview: d.isFreePreview,
        sortOrder: count,
      },
    });

    revalidatePath(`/admin/courses/${d.productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteMaterial(materialId: string, productId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.materials', 'delete');

    const owned = await db.material.findFirst({
      where: { id: materialId, section: { module: { organizationId: tenant.organizationId } } },
      select: { id: true },
    });
    if (!owned) return { error: 'Material not found.' };

    await db.material.delete({ where: { id: materialId } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function moveMaterial(
  materialId: string,
  productId: string,
  direction: 'up' | 'down',
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const current = await db.material.findFirst({
      where: { id: materialId, section: { module: { organizationId: tenant.organizationId } } },
      select: { id: true, sectionId: true, sortOrder: true },
    });
    if (!current) return { error: 'Material not found.' };

    const neighbour = await db.material.findFirst({
      where: {
        sectionId: current.sectionId,
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, sortOrder: true },
    });
    if (!neighbour) return { ok: true };

    await db.$transaction([
      db.material.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      db.material.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
