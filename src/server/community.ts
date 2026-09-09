'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { courseCommunitySlug, toSafeHtml } from '@/lib/community';
import { slugify, uniqueSlug } from '@/lib/slug';
import type { ActionState } from '@/server/courses';

/**
 * The community, and moderation of it.
 *
 * Two rules shape everything here. A learner may only write where they are
 * entitled to read, checked on the server every time rather than inferred from
 * the page they were on. And nothing a learner types is treated as markup:
 * posts arrive as plain text and are escaped into paragraphs, which removes an
 * entire class of problem rather than filtering for it.
 */

async function staffGuard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('community.manage_communities', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (message === 'NOT_ALLOWED') return { error: 'This discussion is not open to you.' };
  console.error('[community]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/**
 * May this person read and write here?
 *
 * Returns the community when they may, throws when they may not. Staff pass
 * everywhere in their own organisation; a learner needs an enrolment that
 * matches the room.
 */
async function entitled(communityId: string) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new Error('UNAUTHORIZED');

  const community = await db.community.findFirst({
    where: { id: communityId, organizationId: tenant.organizationId, isActive: true },
    select: { id: true, slug: true, visibility: true },
  });
  if (!community) throw new Error('NOT_ALLOWED');

  if (user.kind === 'STAFF') return { tenant, user, community };
  if (community.visibility === 'INVITE') throw new Error('NOT_ALLOWED');

  const productId = community.slug.startsWith('course-')
    ? community.slug.slice('course-'.length)
    : null;

  const enrolled = await db.enrollment.count({
    where: {
      userId: user.id,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
      ...(productId ? { productId } : {}),
    },
  });

  // A course room needs an enrolment on that course; a general room needs an
  // enrolment on anything, unless it is open to everyone signed in.
  if (community.visibility === 'PUBLIC' && !productId) return { tenant, user, community };
  if (enrolled === 0) throw new Error('NOT_ALLOWED');

  return { tenant, user, community };
}

/* Rooms --------------------------------------------------------------------- */

const communityShape = z.object({
  name: z.string().trim().min(2, 'Give the room a name').max(120),
  description: z.string().trim().max(400).optional(),
  visibility: z.enum(['PUBLIC', 'ENROLLED', 'INVITE']),
});

export async function saveCommunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant } = await staffGuard();

    const id = String(formData.get('id') ?? '');
    const parsed = communityShape.safeParse({
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      visibility: formData.get('visibility') || 'ENROLLED',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    if (id) {
      const existing = await db.community.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Room not found.' };

      await db.community.update({
        where: { id },
        data: { name: d.name, description: d.description || null, visibility: d.visibility },
      });
    } else {
      const slug = await uniqueSlug(slugify(d.name), async (candidate) => {
        const clash = await db.community.findFirst({
          where: { organizationId: tenant.organizationId, slug: candidate },
          select: { id: true },
        });
        return Boolean(clash);
      });

      await db.community.create({
        data: {
          organizationId: tenant.organizationId,
          name: d.name,
          slug,
          description: d.description || null,
          visibility: d.visibility,
        },
      });
    }

    revalidatePath('/admin/community');
    revalidatePath('/learn/community');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setCommunityActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await staffGuard();

    const community = await db.community.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!community) return { error: 'Room not found.' };

    await db.community.update({ where: { id }, data: { isActive } });

    revalidatePath('/admin/community');
    revalidatePath('/learn/community');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The room for one course, made the first time somebody opens it.
 *
 * Creating it up front for every course would leave a wall of empty rooms; this
 * way a discussion exists exactly when a course has one.
 */
export async function ensureCourseCommunity(productId: string): Promise<ActionState & { id?: string }> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const product = await db.product.findFirst({
      where: { id: productId, organizationId: tenant.organizationId },
      select: { id: true, title: true },
    });
    if (!product) return { error: 'Course not found.' };

    if (user.kind !== 'STAFF') {
      const enrolled = await db.enrollment.count({
        where: {
          organizationId: tenant.organizationId,
          userId: user.id,
          productId,
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        },
      });
      if (enrolled === 0) return { error: 'This discussion is not open to you.' };
    }

    const slug = courseCommunitySlug(productId);
    const existing = await db.community.findFirst({
      where: { organizationId: tenant.organizationId, slug },
      select: { id: true },
    });
    if (existing) return { ok: true, id: existing.id };

    const created = await db.community.create({
      data: {
        organizationId: tenant.organizationId,
        name: `${product.title} discussion`,
        slug,
        visibility: 'ENROLLED',
      },
      select: { id: true },
    });

    return { ok: true, id: created.id };
  } catch (err) {
    return fail(err);
  }
}

/* Posts and comments -------------------------------------------------------- */

export async function createPost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const communityId = String(formData.get('communityId') ?? '');
    const { user, community } = await entitled(communityId);

    const title = String(formData.get('title') ?? '').trim();
    const body = String(formData.get('body') ?? '').trim();

    if (body.length < 2) return { error: 'Write something first.' };
    if (body.length > 8000) return { error: 'That is too long for one post.' };

    await db.communityPost.create({
      data: {
        communityId: community.id,
        authorId: user.id,
        title: title.slice(0, 160) || null,
        bodyHtml: toSafeHtml(body),
      },
    });

    revalidatePath('/learn/community');
    revalidatePath(`/learn/community/${community.id}`);
    revalidatePath('/admin/community');
    return { ok: true, message: 'Posted.' };
  } catch (err) {
    return fail(err);
  }
}

export async function createComment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const postId = String(formData.get('postId') ?? '');

    const post = await db.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, communityId: true },
    });
    if (!post) return { error: 'That post is gone.' };

    const { user, community } = await entitled(post.communityId);

    const body = String(formData.get('body') ?? '').trim();
    if (body.length < 1) return { error: 'Write something first.' };
    if (body.length > 4000) return { error: 'That is too long for a reply.' };

    await db.communityComment.create({
      data: { postId: post.id, authorId: user.id, bodyHtml: toSafeHtml(body) },
    });

    revalidatePath(`/learn/community/${community.id}`);
    revalidatePath('/admin/community');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Report a post.
 *
 * Any member can flag; only staff can unflag or remove. A flag is not a verdict
 * and does not hide anything on its own, because letting one annoyed learner
 * silence another is worse than the post they objected to.
 */
export async function flagPost(postId: string): Promise<ActionState> {
  try {
    const post = await db.communityPost.findUnique({
      where: { id: postId },
      select: { id: true, communityId: true },
    });
    if (!post) return { error: 'That post is gone.' };

    await entitled(post.communityId);
    await db.communityPost.update({ where: { id: postId }, data: { isFlagged: true } });

    revalidatePath('/admin/community');
    return { ok: true, message: 'Reported. Somebody will look at it.' };
  } catch (err) {
    return fail(err);
  }
}

export async function moderatePost(
  postId: string,
  action: 'PIN' | 'UNPIN' | 'CLEAR_FLAG' | 'DELETE',
): Promise<ActionState> {
  try {
    const { tenant, user } = await staffGuard(action === 'DELETE' ? 'delete' : 'edit');

    const post = await db.communityPost.findFirst({
      where: { id: postId, community: { organizationId: tenant.organizationId } },
      select: { id: true, communityId: true, authorId: true },
    });
    if (!post) return { error: 'That post is gone.' };

    if (action === 'DELETE') {
      await db.communityPost.delete({ where: { id: postId } });
    } else {
      await db.communityPost.update({
        where: { id: postId },
        data:
          action === 'PIN'
            ? { isPinned: true }
            : action === 'UNPIN'
              ? { isPinned: false }
              : { isFlagged: false },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: `community.post.${action.toLowerCase()}`,
      entity: 'CommunityPost',
      entityId: postId,
      before: { authorId: post.authorId },
    });

    revalidatePath('/admin/community');
    revalidatePath(`/learn/community/${post.communityId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteComment(commentId: string): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const comment = await db.communityComment.findFirst({
      where: { id: commentId, post: { community: { organizationId: tenant.organizationId } } },
      select: { id: true, authorId: true, post: { select: { communityId: true } } },
    });
    if (!comment) return { error: 'That reply is gone.' };

    // Your own words are yours to withdraw; anybody else's needs a moderator.
    if (comment.authorId !== user.id) {
      await requireStaff('community.moderate_posts', 'delete');
    }

    await db.communityComment.delete({ where: { id: commentId } });

    revalidatePath(`/learn/community/${comment.post.communityId}`);
    revalidatePath('/admin/community');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
