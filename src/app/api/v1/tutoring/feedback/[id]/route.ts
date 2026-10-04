import { revalidatePath } from 'next/cache';
import { bearerUser } from '@/lib/api/auth';
import { fail, ok, readJson, str } from '@/lib/api/http';
import { learnerTutoringView, sendFeedback } from '@/lib/tutoring/learner';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/tutoring/feedback/:id { rating: 1..5, clear?, punctual?, pace?, comment? }
 *
 * The learner on their tutor, asked after the 5th, 10th and 15th class and
 * at the end. It goes to the office, not to the tutor. A rating of two or
 * less needs a few words on what is not working.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { id } = await params;
  const body = await readJson(request);
  const r = await sendFeedback(ctx.tenant, ctx.user.id, { feedbackId: id, rating: body?.rating, clear: body?.clear, punctual: body?.punctual, pace: body?.pace, comment: str(body?.comment, 2000) });
  if (!r.ok) return fail('invalid', r.error, 400);
  revalidatePath('/admin/tutoring', 'layout');
  return ok({ message: r.message, tutoring: await learnerTutoringView(ctx.tenant, ctx.user.id) });
}
