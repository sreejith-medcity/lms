import { revalidatePath } from 'next/cache';
import { can } from '@/lib/permissions';
import { apiStaff } from './staff';
import { fail, ok } from './http';
import { tutorTutoringView, type Actor } from '@/lib/tutoring/tutor';
import type { Outcome } from '@/lib/tutoring/learner';
import type { TenantContext } from '@/lib/tenant';

/**
 * The plumbing the tutor's routes share: who is calling (staff only, the
 * office permission read the way the web reads it), and one answer shape
 * for a change, `{ message, tutoring }`, the view again, so the phone
 * redraws without a second call.
 */
export async function tutorContext(request: Request): Promise<{ tenant: TenantContext; actor: Actor } | null> {
  const ctx = await apiStaff(request);
  if (!ctx) return null;
  return { tenant: ctx.tenant, actor: { id: ctx.user.id, isOffice: can(ctx.user.permissions, 'scheduling.sessions', 'edit') } };
}

export const notStaff = () => fail('unauthorised', 'Sign in as a member of staff.', 401);

export async function answer(tenant: TenantContext, actor: Actor, r: Outcome) {
  if (!r.ok) return fail('invalid', r.error, 400);
  revalidatePath('/admin/tutoring', 'layout');
  revalidatePath('/admin/desk/tutoring');
  revalidatePath('/learn/tutoring');
  return ok({ message: r.message, tutoring: await tutorTutoringView(tenant, actor.id) });
}
