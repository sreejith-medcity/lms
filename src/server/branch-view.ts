'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { BRANCH_VIEW_COOKIE, canSwitchBranch } from '@/lib/scope';
import type { ActionState } from '@/server/courses';

/**
 * Head Office's branch switcher. Sets a cookie that `staffScope` reads to
 * narrow an academy-wide view to one branch, so a head-office person can
 * see what that branch's head sees, approve in their place when they are
 * away, and switch back. Only somebody whose own scope is the academy
 * can set it; for anyone else the cookie is ignored anyway.
 */
export async function viewAsBranch(branchId: string | null): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([requireTenant(), requireStaff()]);
    if (!canSwitchBranch(user)) return { error: 'Your view is already one branch.' };
    const jar = await cookies();
    if (!branchId) {
      jar.delete(BRANCH_VIEW_COOKIE);
    } else {
      const branch = await db.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
      if (!branch) return { error: 'Branch not found.' };
      jar.set(BRANCH_VIEW_COOKIE, branch.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/admin', maxAge: 60 * 60 * 12 });
    }
    revalidatePath('/admin');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message === 'UNAUTHORIZED' ? 'Please sign in again.' : 'Something went wrong.' };
  }
}
