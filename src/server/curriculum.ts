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
  assetId: z.string().trim().optional().or(z.literal('')),
  durationMinutes: z.coerce.number().min(0).optional(),
  isFreePreview: z.boolean(),
  isDownloadable: z.boolean(),
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
      assetId: formData.get('assetId') || '',
      durationMinutes: formData.get('durationMinutes') || undefined,
      isFreePreview: formData.get('isFreePreview') === 'on',
      isDownloadable: formData.get('isDownloadable') === 'on',
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

    // An uploaded file wins over everything else: its own type is authoritative,
    // so a video uploaded under the wrong dropdown still plays as a video.
    let type = d.type;
    let assetId: string | null = null;
    let durationSeconds = d.durationMinutes ? Math.round(d.durationMinutes * 60) : null;

    if (d.assetId) {
      const asset = await db.asset.findFirst({
        where: {
          id: d.assetId,
          organizationId: tenant.organizationId,
          deletedAt: null,
          transcodeStatus: { not: 'UPLOADING' },
        },
        select: { id: true, type: true, durationSeconds: true },
      });
      if (!asset) return { error: 'That file is still uploading, or is no longer available.' };

      assetId = asset.id;
      type = asset.type;
      durationSeconds = durationSeconds ?? asset.durationSeconds;

      await db.asset.update({
        where: { id: asset.id },
        data: { usageCount: { increment: 1 } },
      });
    } else if (!needsUrl && d.type !== 'TEXT_HTML' && d.type !== 'LIVE_SESSION' && d.type !== 'ASSESSMENT' && !d.externalUrl) {
      return { error: 'Upload a file, or paste a link, for this material.' };
    }

    const count = await db.material.count({ where: { sectionId: d.sectionId } });

    await db.material.create({
      data: {
        sectionId: d.sectionId,
        title: d.title,
        type,
        assetId,
        externalUrl: assetId ? null : d.externalUrl || null,
        durationSeconds,
        isFreePreview: d.isFreePreview,
        isDownloadable: d.isDownloadable,
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
      select: { id: true, assetId: true },
    });
    if (!owned) return { error: 'Material not found.' };

    await db.material.delete({ where: { id: materialId } });

    // The file stays in the library. Only its use count drops, which is what
    // makes the "unused" filter there trustworthy.
    if (owned.assetId) {
      await db.asset.update({
        where: { id: owned.assetId },
        data: { usageCount: { decrement: 1 } },
      });
    }

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

/* Sections ----------------------------------------------------------------- */

/** Confirms a section belongs to this tenant. */
async function ownedSection(sectionId: string, organizationId: string) {
  return db.section.findFirst({
    where: { id: sectionId, module: { organizationId } },
    select: { id: true, moduleId: true, title: true, sortOrder: true, isVisible: true },
  });
}

export async function renameSection(
  sectionId: string,
  productId: string,
  title: string,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const trimmed = title.trim();
    if (trimmed.length < 2) return { error: 'Give the section a title.' };

    const section = await ownedSection(sectionId, tenant.organizationId);
    if (!section) return { error: 'Section not found.' };

    await db.section.update({ where: { id: sectionId }, data: { title: trimmed } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Hide a section without deleting it.
 *
 * Half-built weeks are normal while a course is being written, and the
 * alternative — deleting the section and rebuilding it later — loses every
 * material in it. Hidden sections stay out of the learner's rail.
 */
export async function setSectionVisible(
  sectionId: string,
  productId: string,
  isVisible: boolean,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const section = await ownedSection(sectionId, tenant.organizationId);
    if (!section) return { error: 'Section not found.' };

    await db.section.update({ where: { id: sectionId }, data: { isVisible } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    revalidatePath('/learn', 'layout');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function moveSection(
  sectionId: string,
  productId: string,
  direction: 'up' | 'down',
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const current = await ownedSection(sectionId, tenant.organizationId);
    if (!current) return { error: 'Section not found.' };

    const neighbour = await db.section.findFirst({
      where: {
        moduleId: current.moduleId,
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, sortOrder: true },
    });
    if (!neighbour) return { ok: true };

    await db.$transaction([
      db.section.update({ where: { id: current.id }, data: { sortOrder: neighbour.sortOrder } }),
      db.section.update({ where: { id: neighbour.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Copy a section, materials and all.
 *
 * Week 2 is usually week 1 with different files, and rebuilding the shape of it
 * by hand is the single most tedious thing about writing a course here. The copy
 * lands hidden and directly below the original, so a half-edited duplicate is
 * never something a learner sees.
 */
export async function cloneSection(sectionId: string, productId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const source = await db.section.findFirst({
      where: { id: sectionId, module: { organizationId: tenant.organizationId } },
      select: {
        id: true,
        moduleId: true,
        title: true,
        sortOrder: true,
        materials: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!source) return { error: 'Section not found.' };

    await db.$transaction(async (tx) => {
      // Everything below the original shifts down to make room for the copy.
      await tx.section.updateMany({
        where: { moduleId: source.moduleId, sortOrder: { gt: source.sortOrder } },
        data: { sortOrder: { increment: 1 } },
      });

      const copy = await tx.section.create({
        data: {
          moduleId: source.moduleId,
          title: `${source.title} (copy)`.slice(0, 190),
          sortOrder: source.sortOrder + 1,
          isVisible: false,
        },
        select: { id: true },
      });

      if (source.materials.length) {
        await tx.material.createMany({
          data: source.materials.map((m, i) => ({
            sectionId: copy.id,
            title: m.title,
            type: m.type,
            assetId: m.assetId,
            externalUrl: m.externalUrl,
            bodyHtml: m.bodyHtml,
            durationSeconds: m.durationSeconds,
            isFreePreview: m.isFreePreview,
            isDownloadable: m.isDownloadable,
            sortOrder: i,
          })),
        });
      }
    });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true, message: 'Copied, and hidden until you are happy with it.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSection(sectionId: string, productId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.module_library', 'delete');

    const section = await db.section.findFirst({
      where: { id: sectionId, module: { organizationId: tenant.organizationId } },
      select: { id: true, _count: { select: { materials: true } } },
    });
    if (!section) return { error: 'Section not found.' };

    // Deleting a section with learner progress behind it would take the progress
    // with it, so an emptied section is the only one that goes.
    if (section._count.materials > 0) {
      return {
        error: `This section still holds ${section._count.materials} materials. Remove them first, or hide the section instead.`,
      };
    }

    await db.section.delete({ where: { id: sectionId } });

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function moveModule(
  productId: string,
  moduleId: string,
  direction: 'up' | 'down',
): Promise<ActionState> {
  try {
    const { tenant } = await guard();
    const courseId = await courseIdFor(productId, tenant.organizationId);
    if (!courseId) return { error: 'Course not found.' };

    const current = await db.courseModule.findFirst({
      where: { courseId, moduleId },
      select: { moduleId: true, sortOrder: true },
    });
    if (!current) return { error: 'Module not found on this course.' };

    const neighbour = await db.courseModule.findFirst({
      where: {
        courseId,
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { moduleId: true, sortOrder: true },
    });
    if (!neighbour) return { ok: true };

    await db.$transaction([
      db.courseModule.update({
        where: { courseId_moduleId: { courseId, moduleId: current.moduleId } },
        data: { sortOrder: neighbour.sortOrder },
      }),
      db.courseModule.update({
        where: { courseId_moduleId: { courseId, moduleId: neighbour.moduleId } },
        data: { sortOrder: current.sortOrder },
      }),
    ]);

    revalidatePath(`/admin/courses/${productId}/curriculum`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
