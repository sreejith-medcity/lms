import { bearerUser } from '@/lib/api/auth';
import { courseDownloads } from '@/lib/api/downloads';
import { fail, ok } from '@/lib/api/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/courses/:productId/downloads
 *
 * The lessons of a course the learner may keep on the phone, each with a
 * link good for half an hour, and `checkAgainBy`: the phone opens its
 * downloads until then and must call this again (online) to keep them. A
 * downloaded lesson missing from the answer is deleted from the phone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const ctx = await bearerUser(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { productId } = await params;
  const list = await courseDownloads(ctx.tenant, ctx.user, productId);
  if (!list) return fail('not_enrolled', 'You are not enrolled in that course.', 404);
  return ok(list);
}
