'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { slugify } from '@/lib/slug';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import type { ActionState } from '@/server/courses';

/**
 * The public site's content.
 *
 * Pages are blocks of heading and prose rather than free HTML, and posts are
 * plain text. That is a deliberate ceiling: a rich editor on a multi-tenant site
 * is an injection surface, and nothing here needs one yet. When it does, the
 * answer is a sanitiser and a schema, not a paste box.
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to edit the site.' };
  console.error('[storefront]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Pages ------------------------------------------------------------------- */

const page = z.object({
  id: z.string().optional().or(z.literal('')),
  slug: z
    .string()
    .trim()
    .min(2, 'The address needs at least two characters')
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  title: z.string().trim().min(2, 'Give the page a title').max(160),
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(180).optional().or(z.literal('')),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export async function savePage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('blogs.manage_blogs');

    const parsed = page.safeParse({
      id: formData.get('id') || '',
      slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
      title: formData.get('title'),
      seoTitle: formData.get('seoTitle') || '',
      seoDescription: formData.get('seoDescription') || '',
      status: formData.get('status') || 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    // Blocks arrive as parallel arrays, so an empty pair is simply dropped.
    const headings = formData.getAll('blockHeading').map((v) => String(v).trim());
    const bodies = formData.getAll('blockBody').map((v) => String(v).trim());
    const blocks = headings
      .map((heading, i) => ({ heading, body: bodies[i] ?? '' }))
      .filter((b) => b.heading || b.body);

    const clash = await db.storefrontPage.findFirst({
      where: {
        organizationId: tenant.organizationId,
        slug: d.slug,
        ...(d.id ? { id: { not: d.id } } : {}),
      },
      select: { id: true },
    });
    if (clash) return { error: `Another page already lives at /${d.slug}.` };

    const data = {
      slug: d.slug,
      title: d.title,
      blocks: blocks as unknown as Prisma.InputJsonValue,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      status: d.status,
      publishedAt: d.status === 'PUBLISHED' ? new Date() : null,
    };

    if (d.id) {
      const owned = await db.storefrontPage.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!owned) return { error: 'Page not found.' };
      await db.storefrontPage.update({ where: { id: d.id }, data });
    } else {
      await db.storefrontPage.create({
        data: { ...data, organizationId: tenant.organizationId, kind: 'STATIC' },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.status === 'PUBLISHED' ? 'page.published' : 'page.saved',
      entity: 'StorefrontPage',
      entityId: d.id || null,
      after: { slug: d.slug, title: d.title },
    });

    revalidatePath('/admin/storefront');
    revalidatePath(`/${d.slug}`);
    revalidatePath('/about');
    return {
      ok: true,
      message: d.status === 'PUBLISHED' ? `Live at /${d.slug}.` : 'Saved as a draft.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePage(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('blogs.manage_blogs', 'delete');
    await db.storefrontPage.deleteMany({ where: { id, organizationId: tenant.organizationId } });
    revalidatePath('/admin/storefront');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Posts ------------------------------------------------------------------- */

const post = z.object({
  id: z.string().optional().or(z.literal('')),
  title: z.string().trim().min(3, 'Give the post a title').max(180),
  excerpt: z.string().trim().max(300).optional().or(z.literal('')),
  bodyHtml: z.string().trim().min(20, 'Write the post').max(40000),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export async function savePost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('blogs.manage_blogs');

    const parsed = post.safeParse({
      id: formData.get('id') || '',
      title: formData.get('title'),
      excerpt: formData.get('excerpt') || '',
      bodyHtml: formData.get('bodyHtml'),
      tags: formData.get('tags') || '',
      status: formData.get('status') || 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const slug = slugify(d.title);

    const clash = await db.blogPost.findFirst({
      where: {
        organizationId: tenant.organizationId,
        slug,
        ...(d.id ? { id: { not: d.id } } : {}),
      },
      select: { id: true },
    });
    if (clash) return { error: 'Another post already uses that title.' };

    const data = {
      slug,
      title: d.title,
      excerpt: d.excerpt || null,
      bodyHtml: d.bodyHtml,
      tags: d.tags ? d.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      status: d.status,
      publishedAt: d.status === 'PUBLISHED' ? new Date() : null,
      authorId: user.id,
    };

    if (d.id) {
      const owned = await db.blogPost.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId },
        select: { id: true, publishedAt: true },
      });
      if (!owned) return { error: 'Post not found.' };

      await db.blogPost.update({
        where: { id: d.id },
        // Republishing an edit does not reset the original publication date.
        data: { ...data, publishedAt: owned.publishedAt ?? data.publishedAt },
      });
    } else {
      await db.blogPost.create({ data: { ...data, organizationId: tenant.organizationId } });
    }

    revalidatePath('/admin/storefront');
    revalidatePath('/blog');
    revalidatePath(`/blog/${slug}`);
    return { ok: true, message: d.status === 'PUBLISHED' ? `Live at /blog/${slug}.` : 'Draft saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePost(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('blogs.manage_blogs', 'delete');
    await db.blogPost.deleteMany({ where: { id, organizationId: tenant.organizationId } });
    revalidatePath('/admin/storefront');
    revalidatePath('/blog');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
