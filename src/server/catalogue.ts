'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { slugify } from '@/lib/slug';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/** Categories and the shared module library: the two things courses are built from. */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[catalogue]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Categories -------------------------------------------------------------- */

const category = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the category a name').max(80),
  parentId: z.string().optional().or(z.literal('')),
});

export async function saveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('category.manage_categories');

    const parsed = category.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const slug = slugify(d.name);

    const clash = await db.category.findFirst({
      where: { organizationId: tenant.organizationId, slug, ...(d.id ? { id: { not: d.id } } : {}) },
      select: { id: true },
    });
    if (clash) return { error: `A category with the address /${slug} already exists.` };

    if (d.id) {
      const owned = await db.category.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId },
        select: { id: true, slug: true },
      });
      if (!owned) return { error: 'Category not found.' };
      if (d.parentId === d.id) return { error: 'A category cannot be its own parent.' };

      await db.category.update({
        where: { id: d.id },
        data: { name: d.name, slug, parentId: d.parentId || null },
      });

      // Changing a name changes a public URL, which is worth saying out loud.
      if (owned.slug !== slug) {
        await recordAudit({
          organizationId: tenant.organizationId,
          actorId: user.id,
          action: 'category.slug.changed',
          entity: 'Category',
          entityId: d.id,
          before: { slug: owned.slug },
          after: { slug },
        });
      }
    } else {
      const count = await db.category.count({ where: { organizationId: tenant.organizationId } });
      await db.category.create({
        data: {
          organizationId: tenant.organizationId,
          name: d.name,
          slug,
          parentId: d.parentId || null,
          sortOrder: count,
        },
      });
    }

    revalidatePath('/admin/categories');
    revalidatePath('/', 'layout');
    return {
      ok: true,
      message: d.id ? `Saved. This category now lives at /courses/${slug}.` : 'Category created.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function setCategoryActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard('category.manage_categories');
    await db.category.updateMany({
      where: { id, organizationId: tenant.organizationId },
      data: { isActive },
    });
    revalidatePath('/admin/categories');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCategory(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('category.manage_categories', 'delete');

    const cat = await db.category.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { _count: { select: { courses: true, children: true } } },
    });
    if (!cat) return { error: 'Category not found.' };
    if (cat._count.courses > 0) {
      return { error: `${cat._count.courses} course${cat._count.courses === 1 ? ' is' : 's are'} in this category. Move them first.` };
    }
    if (cat._count.children > 0) return { error: 'This category has sub-categories.' };

    await db.category.delete({ where: { id } });
    revalidatePath('/admin/categories');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setCourseCategories(
  courseId: string,
  categoryIds: string[],
): Promise<ActionState> {
  try {
    const { tenant } = await guard('courses.course_management');

    const owned = await db.course.findFirst({
      where: { id: courseId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!owned) return { error: 'Course not found.' };

    const valid = await db.category.findMany({
      where: { id: { in: categoryIds }, organizationId: tenant.organizationId },
      select: { id: true },
    });

    await db.$transaction([
      db.courseCategory.deleteMany({ where: { courseId } }),
      db.courseCategory.createMany({
        data: valid.map((c) => ({ courseId, categoryId: c.id })),
        skipDuplicates: true,
      }),
    ]);

    revalidatePath('/admin/categories');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Module library ---------------------------------------------------------- */

export async function saveModule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.module_library');

    const id = String(formData.get('id') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    if (name.length < 2) return { error: 'Give the module a name.' };

    if (id) {
      const owned = await db.module.findFirst({
        where: { id, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!owned) return { error: 'Module not found.' };
      await db.module.update({ where: { id }, data: { name, description: description || null } });
    } else {
      await db.module.create({
        data: { organizationId: tenant.organizationId, name, description: description || null },
      });
    }

    revalidatePath('/admin/modules');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A module in use is not deleted, because it is shared: removing it would empty
 * it out of every course at once. Unlink it from each course instead.
 */
export async function deleteModule(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('module.module_library', 'delete');

    const mod = await db.module.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, _count: { select: { courses: true, batches: true } } },
    });
    if (!mod) return { error: 'Module not found.' };
    if (mod._count.courses > 0 || mod._count.batches > 0) {
      return {
        error: `Used by ${mod._count.courses} course${mod._count.courses === 1 ? '' : 's'}. Remove it from those first.`,
      };
    }

    await db.module.update({ where: { id }, data: { deletedAt: new Date() } });
    revalidatePath('/admin/modules');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
