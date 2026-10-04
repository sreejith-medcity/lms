import { revalidatePath } from 'next/cache';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { chooseSlot, learnerTutoringView } from '@/lib/tutoring/learner';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/tutoring/seats { offerId, time: "HH:MM", fromDay?: "YYYY-MM-DD" }
 *
 * The learner picks their class time. They are placed with a tutor at once
 * when one is free then, and wait otherwise; the message says which. The
 * answer carries the view again, so the screen redraws without a second call.
 */
export async function POST(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const body = await readJson(request);
  const r = await chooseSlot(ctx.tenant, ctx.user.id, { offerId: str(body?.offerId, 60), time: str(body?.time, 5), fromDay: str(body?.fromDay, 10) });
  if (!r.ok) return fail('invalid', r.error, 400);
  revalidatePath('/admin/tutoring', 'layout');
  revalidatePath('/admin/desk/tutoring');
  return ok({ message: r.message, tutoring: await learnerTutoringView(ctx.tenant, ctx.user.id) }, { status: 201 });
}
