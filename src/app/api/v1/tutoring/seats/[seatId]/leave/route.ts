import { revalidatePath } from 'next/cache';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { learnerTutoringView, takeLeave } from '@/lib/tutoring/learner';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/tutoring/seats/:seatId/leave { fromDay: "YYYY-MM-DD", toDay?, reason? }
 *
 * Leave of up to three days at a time, from today on, with no approval. One
 * to one, the classes move to the end of the course; in a group the class
 * goes on and the learner is marked excused. The tutor is told either way.
 */
export async function POST(request: Request, { params }: { params: Promise<{ seatId: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { seatId } = await params;
  const body = await readJson(request);
  const r = await takeLeave(ctx.tenant, ctx.user.id, { seatId, fromDay: str(body?.fromDay, 10), toDay: str(body?.toDay, 10), reason: str(body?.reason, 500) });
  if (!r.ok) return fail('invalid', r.error, 400);
  revalidatePath('/admin/tutoring', 'layout');
  revalidatePath('/admin/desk/tutoring');
  return ok({ message: r.message, tutoring: await learnerTutoringView(ctx.tenant, ctx.user.id) }, { status: 201 });
}
