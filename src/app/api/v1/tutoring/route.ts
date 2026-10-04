import { bearerUser } from '@/lib/api/auth';
import { fail, ok } from '@/lib/api/http';
import { learnerTutoringView } from '@/lib/tutoring/learner';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/tutoring
 *
 * A learner's online tutoring, the same view the web page draws: the class
 * times they may choose for a course taught with a tutor, their tutor and
 * how far along they are, the feedback asked of them, the tutor's progress
 * notes and their leave. `applies` says whether the screen is worth a place
 * in the app's menu, `attention` how many things are waiting on them.
 * Days are YYYY-MM-DD on the academy's calendar; `nextClassAt` and
 * `submittedAt` are instants.
 */
export async function GET(request: Request) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  return ok(await learnerTutoringView(ctx.tenant, ctx.user.id));
}
