'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { toPaise } from '@/lib/money';
import type { ActionState } from '@/server/courses';

/**
 * Instructor profiles.
 *
 * The public course page names whoever teaches a batch, and without this it can
 * only say a name. A headline and two sentences is the difference between a
 * course that looks staffed and one that looks like a shelf.
 *
 * `hideNameOnCards` exists because some trainers would rather not be listed
 * publicly, and that is theirs to decide rather than something to argue about.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('instructor.instructor_management', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[instructors]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const profileShape = z.object({
  userId: z.string().min(1),
  headline: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(600).optional(),
  expertise: z.string().trim().max(300).optional(),
  hourlyRateRupees: z.coerce.number().min(0).optional(),
});

export async function saveInstructorProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const parsed = profileShape.safeParse({
      userId: formData.get('userId'),
      headline: formData.get('headline') || undefined,
      bio: formData.get('bio') || undefined,
      expertise: formData.get('expertise') || undefined,
      hourlyRateRupees: formData.get('hourlyRateRupees') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const member = await db.user.findFirst({
      where: {
        id: d.userId,
        organizationId: tenant.organizationId,
        kind: 'STAFF',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!member) return { error: 'That person is not on the team.' };

    const expertise = (d.expertise ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
      .slice(0, 12);

    const data = {
      headline: d.headline || null,
      bio: d.bio || null,
      expertise,
      hourlyRatePaise: d.hourlyRateRupees ? toPaise(d.hourlyRateRupees) : null,
      isMentor: formData.get('isMentor') === 'on',
      hideNameOnCards: formData.get('hideNameOnCards') === 'on',
    };

    await db.instructorProfile.upsert({
      where: { userId: member.id },
      create: { userId: member.id, ...data },
      update: data,
    });

    revalidatePath('/admin/instructors');
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}
